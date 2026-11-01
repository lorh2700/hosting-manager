import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const target = '20261101020000_password_reset';
const checksum = '72f076ace1b96a0cefdb586bc6578df00712aa2fcf7653e206c2070f716e45d2';
const migration = await readFile(new URL(`../prisma/migrations/${target}/migration.sql`, import.meta.url), 'utf8');
const wrapper = await readFile(new URL('../scripts/db/apply-password-reset-20261101.sql', import.meta.url), 'utf8');
const localWrapper = wrapper.replace("target_database CONSTANT text := 'hosting_manager_cutover_20261030';", "target_database CONSTANT text := 'postgres';");
const tables = ['password_reset_limits', 'password_reset_requests'];

async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE hosting_manager_app; CREATE ROLE unrelated_app;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    CREATE TABLE users(id text PRIMARY KEY,email text,password text,status text);
    CREATE TABLE backend_commands(id text PRIMARY KEY);
    CREATE TABLE _prisma_migrations(id varchar(36) PRIMARY KEY,checksum varchar(64) NOT NULL,
      finished_at timestamptz,migration_name varchar(255) NOT NULL,logs text,rolled_back_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT now(),applied_steps_count integer NOT NULL DEFAULT 0);
    INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES('prior','prior',now(),'prior_migration',1);
    INSERT INTO users VALUES('u1','fixture@example.invalid','fixture-hash','active');
    SET password_reset.verified_table_owner='postgres';
    SET password_reset.verified_api_user='hosting_manager_app';`);
  return db;
}
async function apply(db: PGlite, sql = localWrapper) {
  try { await db.exec(sql); }
  catch (error) { await db.exec('ROLLBACK'); throw error; }
}
async function state(db: PGlite) {
  return {
    users: (await db.query<Record<string, unknown>>('SELECT * FROM users ORDER BY id')).rows,
    history: (await db.query<{ id: string; migration_name: string; checksum: string; applied_steps_count: number }>('SELECT * FROM _prisma_migrations ORDER BY id')).rows,
    tables: (await db.query<{ relname: string; owner: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`SELECT relname,
      pg_get_userbyid(relowner) AS owner,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND relname=ANY($1::text[]) ORDER BY relname`, [tables])).rows,
  };
}

test('password reset wrapper pins exact canonical SQL, checksum, database and transaction bounds', () => {
  assert.equal(wrapper.split('$password_reset_sql$')[1], migration);
  assert.equal(createHash('sha256').update(migration).digest('hex'), checksum);
  assert.match(wrapper, /^BEGIN;\r?\nSET LOCAL lock_timeout = '3s';\r?\nSET LOCAL statement_timeout = '30s';/);
  assert.match(wrapper, /COMMIT;\s*$/);
  assert.notEqual(wrapper, localWrapper);
});

test('applies only password reset, preserves existing credentials and history, and never resets versions on replay', async () => {
  const db = await fixture();
  try {
    const original = await state(db);
    await db.exec('ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO PUBLIC,anon,authenticated,hosting_manager_app');
    await apply(db);
    const first = await state(db);
    assert.deepEqual(first.users, [{ ...original.users[0], credential_version: 0 }]);
    assert.deepEqual(first.history.filter(row => row.migration_name !== target), original.history);
    const applied = first.history.filter(row => row.migration_name === target);
    assert.equal(applied.length, 1); assert.equal(applied[0].checksum, checksum); assert.equal(applied[0].applied_steps_count, 1);
    assert.equal(first.tables.length, 2);
    assert.ok(first.tables.every(row => row.owner === 'postgres' && row.relrowsecurity && !row.relforcerowsecurity));
    await db.exec("UPDATE users SET credential_version=7 WHERE id='u1'");
    const changed = await state(db);
    await apply(db);
    assert.deepEqual(await state(db), changed);
    await db.exec("INSERT INTO users(id,email,password,status) VALUES('u2','new@example.invalid','another-hash','active')");
    assert.equal((await db.query<{ credential_version: number }>("SELECT credential_version FROM users WHERE id='u2'")).rows[0].credential_version, 0);
    await assert.rejects(db.exec("UPDATE users SET credential_version=-1 WHERE id='u1'"), /check constraint/);
  } finally { await db.close(); }
});

test('runtime can select, insert and update while delete, DDL and browser access remain denied', async () => {
  const db = await fixture();
  try {
    await apply(db);
    await db.exec('SET ROLE hosting_manager_app');
    await db.exec(`INSERT INTO password_reset_limits VALUES('rate-hash',now(),now(),1);
      INSERT INTO password_reset_requests(id,email,user_id,credential_version,token_hash,code_hash,delivery_status,expires_at)
      VALUES('request','fixture@example.invalid','u1',0,'token-hash','code-hash','sent',now()+interval '15 minutes');
      UPDATE password_reset_limits SET request_count=2;
      UPDATE password_reset_requests SET attempts=1;`);
    assert.equal((await db.query<{ attempts: number }>('SELECT attempts FROM password_reset_requests')).rows[0].attempts, 1);
    assert.equal((await db.query<{ request_count: number }>('SELECT request_count FROM password_reset_limits')).rows[0].request_count, 2);
    for (const table of tables) {
      await assert.rejects(db.exec(`DELETE FROM ${table}`), /permission denied/);
      await assert.rejects(db.exec(`TRUNCATE ${table}`), /permission denied/);
    }
    await assert.rejects(db.query('SELECT * FROM _prisma_migrations'), /permission denied/);
    await assert.rejects(db.exec('CREATE TABLE forbidden(id text)'), /permission denied/);
    await db.exec('RESET ROLE');
    for (const role of ['anon','authenticated','unrelated_app']) {
      await db.exec(`SET ROLE ${role}`);
      for (const table of tables) await assert.rejects(db.query(`SELECT * FROM ${table}`), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('GRANT SELECT,INSERT,UPDATE ON password_reset_limits TO unrelated_app; SET ROLE unrelated_app');
    assert.deepEqual((await db.query('SELECT * FROM password_reset_limits')).rows, []);
    assert.deepEqual((await db.query('UPDATE password_reset_limits SET request_count=99 RETURNING *')).rows, []);
    await assert.rejects(db.exec("INSERT INTO password_reset_limits VALUES('unrelated',now(),now(),1)"), /row-level security/);
  } finally { await db.close(); }
});

for (const [name, change, error] of [
  ['wrong database', '', /wrong_database/],
  ['missing verification', 'RESET password_reset.verified_api_user', /requires_verified/],
  ['different verified owner', "SET password_reset.verified_table_owner='unrelated_app'", /verified_role_mismatch/],
  ['different verified API role', "SET password_reset.verified_api_user='unrelated_app'", /verified_role_mismatch/],
  ['privileged API role', 'ALTER ROLE hosting_manager_app BYPASSRLS', /missing_or_privileged/],
  ['API role owner membership', 'GRANT postgres TO hosting_manager_app', /api_role_inherits/],
  ['private table owner drift', 'ALTER TABLE backend_commands OWNER TO unrelated_app', /private_owner_mismatch/],
  ['missing prerequisite', 'DROP TABLE backend_commands', /missing_prerequisite/],
  ['incorrect history schema', 'ALTER TABLE _prisma_migrations ALTER COLUMN checksum TYPE text', /invalid_migration_history_schema/],
  ['preexisting credential column', 'ALTER TABLE users ADD credential_version integer', /preexisting_credential_version/],
  ['preexisting reset table', 'CREATE TABLE password_reset_limits(key_hash text)', /preexisting_objects/],
  ['preexisting reset type', "CREATE TYPE password_reset_requests AS ENUM('collision')", /preexisting_objects/],
] as const) test(`refuses ${name} before mutation`, async () => {
  const db = await fixture();
  try {
    if (change) await db.exec(change);
    const before = await state(db);
    await assert.rejects(apply(db, name === 'wrong database' ? wrapper : localWrapper), error);
    assert.deepEqual(await state(db), before);
  } finally { await db.close(); }
});

for (const [name, change, error] of [
  ['altered checksum', `UPDATE _prisma_migrations SET checksum='bad' WHERE migration_name='${target}'`, /applied_checksum_mismatch/],
  ['incomplete history', `UPDATE _prisma_migrations SET finished_at=NULL WHERE migration_name='${target}'`, /incomplete_migration_history/],
  ['rolled-back history', `UPDATE _prisma_migrations SET rolled_back_at=now() WHERE migration_name='${target}'`, /incomplete_migration_history/],
  ['ambiguous history', `INSERT INTO _prisma_migrations SELECT 'duplicate',checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count FROM _prisma_migrations WHERE migration_name='${target}'`, /ambiguous_migration_history/],
  ['missing table', 'DROP TABLE password_reset_requests', /private_table_state_mismatch/],
  ['disabled RLS', 'ALTER TABLE password_reset_limits DISABLE ROW LEVEL SECURITY', /private_table_state_mismatch/],
  ['browser grant', 'GRANT SELECT ON password_reset_requests TO anon', /browser_access/],
  ['extra policy', 'CREATE POLICY browser_policy ON password_reset_limits FOR SELECT USING(true)', /api_policy_mismatch/],
  ['missing runtime grant', 'REVOKE UPDATE ON password_reset_requests FROM hosting_manager_app', /api_privilege_mismatch/],
  ['excessive runtime delete grant', 'GRANT DELETE ON password_reset_limits TO hosting_manager_app', /api_privilege_mismatch/],
  ['wrong credential default', 'ALTER TABLE users ALTER COLUMN credential_version SET DEFAULT 1', /credential_version_state_mismatch/],
  ['nullable credential version', 'ALTER TABLE users ALTER COLUMN credential_version DROP NOT NULL', /credential_version_state_mismatch/],
  ['missing nonnegative constraint', 'ALTER TABLE users DROP CONSTRAINT users_credential_version_check', /credential_version_state_mismatch/],
  ['unvalidated nonnegative constraint', 'ALTER TABLE users DROP CONSTRAINT users_credential_version_check; ALTER TABLE users ADD CHECK(credential_version>=0) NOT VALID', /credential_version_state_mismatch/],
  ['missing private column', 'ALTER TABLE password_reset_requests DROP code_hash', /private_column_state_mismatch/],
] as const) test(`refuses applied history with ${name}`, async () => {
  const db = await fixture();
  try {
    await apply(db); await db.exec(change);
    const before = await state(db);
    await assert.rejects(apply(db), error);
    assert.deepEqual(await state(db), before);
  } finally { await db.close(); }
});

test('failed history write rolls back new tables and credential version completely', async () => {
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

test('altered embedded DDL is rejected before any write even with a verified database and roles', async () => {
  const db = await fixture();
  try {
    const before = await state(db);
    await assert.rejects(apply(db, localWrapper.replace('CHECK (credential_version >= 0)', 'CHECK (credential_version >= -1)')), /embedded_migration_checksum_mismatch/);
    assert.deepEqual(await state(db), before);
  } finally { await db.close(); }
});
