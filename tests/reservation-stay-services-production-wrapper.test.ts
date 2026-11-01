import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const target = '20261101010000_reservation_stay_services';
const migration = await readFile(new URL(`../prisma/migrations/${target}/migration.sql`, import.meta.url), 'utf8');
const wrapper = await readFile(new URL('../scripts/db/apply-reservation-stay-services-20261101.sql', import.meta.url), 'utf8');
const localWrapper = wrapper.replace("target_database CONSTANT text := 'hosting_manager_cutover_20261030';", "target_database CONSTANT text := 'postgres';");

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE hosting_manager_app; CREATE ROLE unrelated_app;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    CREATE TABLE users(id text PRIMARY KEY);
    CREATE TABLE properties(id text PRIMARY KEY);
    CREATE TABLE cleanings(id text PRIMARY KEY, property_id text NOT NULL REFERENCES properties(id), origin text NOT NULL);
    CREATE TABLE audit_logs(target_id text, property_id text, action text, target_type text, details jsonb);
    CREATE TABLE backend_commands(id text PRIMARY KEY);
    CREATE TABLE _prisma_migrations(id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL,
      finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0);
    INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count)
      VALUES ('prior','prior',now(),'prior_migration',1);
    INSERT INTO properties VALUES ('p1'),('p2');
    INSERT INTO cleanings VALUES ('linked','p1','interim'),('ambiguous','p1','interim'),
      ('cross-property','p1','interim'),('checkout','p1','auto'),('no-audit','p1','interim');
    INSERT INTO audit_logs VALUES
      ('linked','p1','cleaning.interim.create','cleaning','{"reservationId":"event:one"}'),
      ('ambiguous','p1','cleaning.interim.create','cleaning','{"reservationId":"event:two"}'),
      ('ambiguous','p1','cleaning.interim.create','cleaning','{"reservationId":"event:three"}'),
      ('cross-property','p2','cleaning.interim.create','cleaning','{"reservationId":"event:four"}'),
      ('checkout','p1','cleaning.interim.create','cleaning','{"reservationId":"event:five"}');
    SET stay_services.verified_table_owner = 'postgres';
    SET stay_services.verified_api_user = 'hosting_manager_app';
  `);
  return db;
}
async function apply(db: PGlite, sql = localWrapper) {
  try { await db.exec(sql); } catch (error) { await db.exec('ROLLBACK'); throw error; }
}
async function state(db: PGlite) {
  return {
    history: (await db.query('SELECT * FROM _prisma_migrations ORDER BY id')).rows,
    cleanings: (await db.query<{ id: string; reservation_id?: string | null }>('SELECT * FROM cleanings ORDER BY id')).rows,
    table: (await db.query("SELECT relrowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname='backend_reservation_pickups'")).rows,
  };
}
test('wrapper pins exact migration, transaction bounds and production target', () => {
  assert.equal(wrapper.split('$stay_services_sql$')[1], migration);
  assert.ok(wrapper.includes(createHash('sha256').update(migration).digest('hex')));
  assert.match(wrapper, /^BEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '30s';/);
  assert.notEqual(wrapper, localWrapper);
});
test('migration links only unambiguous same-property interim records and is idempotent', async () => {
  const db = await fixture();
  try {
    const oldHistory = (await state(db)).history;
    await db.exec('ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO PUBLIC,anon,authenticated');
    await apply(db);
    const first = await state(db);
    assert.deepEqual(first.table, [{ relrowsecurity: true, owner: 'postgres' }]);
    assert.equal(first.cleanings.find((row: any) => row.id === 'linked')?.reservation_id, 'event:one');
    assert.ok(first.cleanings.filter((row: any) => row.id !== 'linked').every((row: any) => row.reservation_id === null));
    assert.deepEqual(first.history.filter((row: any) => row.migration_name !== target), oldHistory);
    assert.equal(first.history.filter((row: any) => row.migration_name === target).length, 1);
    await apply(db);
    assert.deepEqual(await state(db), first);
  } finally { await db.close(); }
});
test('runtime DML works while browser/unrelated roles and DDL remain denied', async () => {
  const db = await fixture();
  try {
    await apply(db);
    await db.exec('SET ROLE hosting_manager_app');
    await db.exec(`INSERT INTO backend_reservation_pickups(property_id,reservation_key,reservation_id,arrival,updated_by)
      VALUES ('p1','beds24:1','event:one','{"type":"airport"}','operator');
      UPDATE backend_reservation_pickups SET version=2;`);
    assert.equal((await db.query<{ version: number }>('SELECT version FROM backend_reservation_pickups')).rows[0].version, 2);
    await assert.rejects(db.exec('TRUNCATE backend_reservation_pickups'), /permission denied/);
    await db.exec('DELETE FROM backend_reservation_pickups; RESET ROLE');
    for (const role of ['anon','authenticated','unrelated_app']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT * FROM backend_reservation_pickups'), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('GRANT SELECT ON backend_reservation_pickups TO unrelated_app; SET ROLE unrelated_app');
    assert.deepEqual((await db.query('SELECT * FROM backend_reservation_pickups')).rows, []);
  } finally { await db.close(); }
});
for (const [name, change, error] of [
  ['wrong database', '', /wrong_database/],
  ['missing role verification', 'RESET stay_services.verified_api_user', /requires_verified/],
  ['privileged runtime role', 'ALTER ROLE hosting_manager_app BYPASSRLS', /missing_or_privileged/],
  ['preexisting link', 'ALTER TABLE cleanings ADD reservation_id text', /preexisting_cleaning_link/],
  ['wrong table owner', "SET stay_services.verified_table_owner='unrelated_app'", /owner_mismatch/],
] as const) test(`refuses ${name} before mutating existing data`, async () => {
  const db = await fixture();
  try {
    if (change) await db.exec(change);
    const before = await state(db);
    await assert.rejects(apply(db, name === 'wrong database' ? wrapper : localWrapper), error);
    assert.deepEqual(await state(db), before);
  } finally { await db.close(); }
});
test('failed history write rolls back DDL and cleaning backfill', async () => {
  const db = await fixture();
  try {
    const before = await state(db);
    await db.exec(`CREATE FUNCTION reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'synthetic_history_failure'; END $$;
      CREATE TRIGGER reject_history BEFORE INSERT ON _prisma_migrations FOR EACH ROW EXECUTE FUNCTION reject_history();`);
    await assert.rejects(apply(db), /synthetic_history_failure/);
    assert.deepEqual(await state(db), before);
  } finally { await db.close(); }
});
for (const [name, change, error] of [
  ['changed history', "UPDATE _prisma_migrations SET checksum='bad' WHERE migration_name='20261101010000_reservation_stay_services'", /checksum_mismatch/],
  ['missing link column', 'ALTER TABLE cleanings DROP reservation_id', /cleaning_link_state_mismatch/],
  ['browser grant', 'GRANT SELECT ON backend_reservation_pickups TO anon', /browser_access/],
] as const) test(`refuses already-applied migration with ${name}`, async () => {
  const db = await fixture();
  try {
    await apply(db); await db.exec(change);
    const before = await state(db);
    await assert.rejects(apply(db), error);
    assert.deepEqual(await state(db), before);
  } finally { await db.close(); }
});
