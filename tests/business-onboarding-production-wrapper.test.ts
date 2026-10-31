import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const wrapper = await readFile(new URL('../scripts/db/apply-business-onboarding-20261031.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../prisma/migrations/20261031160000_business_onboarding/migration.sql', import.meta.url), 'utf8');
const target = '20261031160000_business_onboarding';
const checksum = 'a044512fa94c968e4763120bb3f1bca6deb4529ea8e5011cbadff451166ee536';
const localWrapper = wrapper.replace("target_database CONSTANT text := 'hosting_manager_cutover_20261030';", "target_database CONSTANT text := 'postgres';");
const tables = ['business_signup_email_limits', 'business_email_verifications', 'business_signup_applications'];

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE hosting_manager_app;
    CREATE ROLE unrelated_app;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    CREATE TABLE users(id text PRIMARY KEY);
    CREATE TABLE organizations(id text PRIMARY KEY);
    CREATE TABLE backend_commands(id text PRIMARY KEY);
    ALTER TABLE backend_commands ENABLE ROW LEVEL SECURITY;
    CREATE TABLE _prisma_migrations (
      id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL,
      finished_at timestamptz, migration_name varchar(255) NOT NULL,
      logs text, rolled_back_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0
    );
    INSERT INTO users VALUES ('existing-user');
    INSERT INTO organizations VALUES ('existing-org');
    INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count)
      VALUES ('existing', 'existing-checksum', now(), 'existing-migration', 1);
    SET onboarding.verified_table_owner = 'postgres';
    SET onboarding.verified_api_user = 'hosting_manager_app';
  `);
  return db;
}

async function apply(db: PGlite, sql = localWrapper) {
  try { await db.exec(sql); }
  catch (error) { await db.exec('ROLLBACK'); throw error; }
}

async function targetState(db: PGlite) {
  return {
    tables: (await db.query(`SELECT c.relname, pg_get_userbyid(c.relowner) AS owner,
      c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) ORDER BY c.relname`, [tables])).rows,
    history: (await db.query('SELECT * FROM _prisma_migrations WHERE migration_name = $1', [target])).rows,
  };
}

test('wrapper embeds the exact reviewed migration and pins bounded transaction settings', () => {
  assert.equal(wrapper.split('$onboarding_sql$')[1], migration);
  assert.equal(createHash('sha256').update(migration).digest('hex'), checksum);
  assert.match(wrapper, /^BEGIN;\r?\nSET LOCAL lock_timeout = '3s';\r?\nSET LOCAL statement_timeout = '30s';/);
  assert.match(wrapper, /COMMIT;\s*$/);
  assert.notEqual(localWrapper, wrapper);
});

test('applies only onboarding, preserves existing data/history, revokes browser access, and is idempotent', async () => {
  const db = await fixture();
  try {
    const originalHistory = (await db.query('SELECT * FROM _prisma_migrations')).rows;
    await db.exec('ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, PUBLIC');
    await apply(db);
    const first = await targetState(db);
    assert.equal(first.tables.length, 3);
    for (const row of first.tables) {
      assert.equal(row.owner, 'postgres');
      assert.equal(row.relrowsecurity, true);
      assert.equal(row.relforcerowsecurity, false);
    }
    assert.equal(first.history.length, 1);
    assert.equal(first.history[0].checksum, checksum);
    assert.equal(first.history[0].applied_steps_count, 1);
    assert.match(String(first.history[0].id), /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query<{ allowed: boolean }>(`SELECT bool_or(has_table_privilege($1, c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS allowed
        FROM pg_class c WHERE c.relname = ANY($2::text[])`, [role, tables])).rows[0].allowed, false);
    }
    await apply(db);
    assert.deepEqual(await targetState(db), first);
    assert.deepEqual((await db.query('SELECT * FROM _prisma_migrations WHERE migration_name <> $1', [target])).rows, originalHistory);
    assert.deepEqual((await db.query('SELECT * FROM users')).rows, [{ id: 'existing-user' }]);
    assert.deepEqual((await db.query('SELECT * FROM organizations')).rows, [{ id: 'existing-org' }]);
  } finally { await db.close(); }
});

test('unmodified production wrapper refuses any other database', async () => {
  const db = await fixture();
  try {
    await assert.rejects(apply(db, wrapper), /onboarding_wrong_database/);
    assert.deepEqual(await targetState(db), { tables: [], history: [] });
  } finally { await db.close(); }
});

for (const [title, change, error] of [
  ['missing role verification', "RESET onboarding.verified_table_owner", /requires_verified_table_owner/],
  ['wrong owner', "SET onboarding.verified_table_owner = 'missing'", /private_owner_mismatch/],
  ['browser API role', "SET onboarding.verified_api_user = 'anon'", /requires_separate_private_api_role/],
  ['owner as API role', "SET onboarding.verified_api_user = 'postgres'", /requires_separate_private_api_role/],
  ['missing API role', "SET onboarding.verified_api_user = 'missing'", /missing_or_privileged_api_role/],
  ['API bypass RLS role', "ALTER ROLE hosting_manager_app BYPASSRLS", /missing_or_privileged_api_role/],
  ['API owner membership', "GRANT postgres TO hosting_manager_app", /api_role_inherits_table_owner/],
  ['missing reference table', 'DROP TABLE organizations', /missing_prerequisite/],
  ['wrong history schema', 'ALTER TABLE _prisma_migrations ALTER COLUMN checksum TYPE text', /invalid_migration_history_schema/],
  ['preexisting table', 'CREATE TABLE business_signup_email_limits(email text)', /preexisting_objects_without_history/],
  ['preexisting type', 'CREATE TYPE business_signup_email_limits AS ENUM (\'collision\')', /preexisting_objects_without_history/],
] as const) test(`refuses ${title} without altering existing state`, async () => {
  const db = await fixture();
  try {
    await db.exec(change);
    const before = await targetState(db);
    await assert.rejects(apply(db), error);
    assert.deepEqual(await targetState(db), before);
  } finally { await db.close(); }
});

for (const [title, change, error] of [
  ['checksum mismatch', "UPDATE _prisma_migrations SET checksum = 'wrong' WHERE migration_name = '20261031160000_business_onboarding'", /applied_checksum_mismatch/],
  ['unfinished history', "UPDATE _prisma_migrations SET finished_at = NULL WHERE migration_name = '20261031160000_business_onboarding'", /incomplete_migration_history/],
  ['rolled back history', "UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = '20261031160000_business_onboarding'", /incomplete_migration_history/],
  ['ambiguous history', "INSERT INTO _prisma_migrations SELECT 'duplicate', checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count FROM _prisma_migrations WHERE migration_name = '20261031160000_business_onboarding'", /ambiguous_migration_history/],
  ['missing applied table', 'DROP TABLE business_signup_applications', /private_table_state_mismatch/],
  ['disabled RLS', 'ALTER TABLE business_signup_applications DISABLE ROW LEVEL SECURITY', /private_table_state_mismatch/],
  ['unexpected browser permission', 'GRANT SELECT ON business_signup_applications TO anon', /browser_access_or_policy_exists/],
  ['missing API policy', 'DROP POLICY hosting_manager_app_runtime_v1 ON business_signup_applications', /api_policy_mismatch/],
  ['missing API privilege', 'REVOKE UPDATE ON business_signup_applications FROM hosting_manager_app', /api_privilege_mismatch/],
  ['excessive API privilege', 'GRANT TRUNCATE ON business_signup_applications TO hosting_manager_app', /api_privilege_mismatch/],
  ['unexpected public policy', 'CREATE POLICY unexpected ON business_signup_applications FOR SELECT USING (true)', /api_policy_mismatch/],
] as const) test(`refuses an apparent no-op with ${title}`, async () => {
  const db = await fixture();
  try {
    await apply(db);
    await db.exec(change);
    const before = await targetState(db);
    await assert.rejects(apply(db), error);
    assert.deepEqual(await targetState(db), before);
  } finally { await db.close(); }
});

test('failed migration history insert rolls back all onboarding DDL', async () => {
  const db = await fixture();
  try {
    await db.exec(`CREATE FUNCTION reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'synthetic_history_failure'; END $$;
      CREATE TRIGGER reject_history BEFORE INSERT ON _prisma_migrations FOR EACH ROW EXECUTE FUNCTION reject_history();`);
    await assert.rejects(apply(db), /synthetic_history_failure/);
    assert.deepEqual(await targetState(db), { tables: [], history: [] });
  } finally { await db.close(); }
});

test('safely quotes both the verified owner and separate API role', async () => {
  const db = await fixture();
  try {
    await db.exec(`CREATE ROLE "backend \"\"owner";
      CREATE ROLE "api \"\"role";
      ALTER TABLE backend_commands OWNER TO "backend \"\"owner";
      SET onboarding.verified_table_owner = 'backend "owner';
      SET onboarding.verified_api_user = 'api "role';`);
    await apply(db);
    for (const row of (await targetState(db)).tables) assert.equal(row.owner, 'backend "owner');
    await db.exec('SET ROLE "api ""role"');
    assert.deepEqual((await db.query('SELECT * FROM business_signup_applications')).rows, []);
    await db.exec('RESET ROLE');
  } finally { await db.close(); }
});

test('API role can use all onboarding DML while browser and unrelated roles cannot', async () => {
  const db = await fixture();
  try {
    await apply(db);
    await db.exec('SET ROLE hosting_manager_app');
    await db.exec(`
      INSERT INTO business_signup_email_limits VALUES ('fixture@example.invalid', now(), now(), 1);
      INSERT INTO business_email_verifications(id, email, token_hash, code_hash, expires_at)
        VALUES ('verify', 'fixture@example.invalid', 'synthetic-token-hash', 'synthetic-code-hash', now() + interval '10 minutes');
      INSERT INTO business_signup_applications(id, verification_id, email, business_name, contact_name,
        contact_phone, password_hash, email_verified_at)
        VALUES ('application', 'verify', 'fixture@example.invalid', 'Synthetic business', 'Synthetic contact',
          'synthetic-phone', 'synthetic-password-hash', now());
      UPDATE business_signup_email_limits SET sent_count = 2;
      UPDATE business_email_verifications SET attempts = 1;
      UPDATE business_signup_applications SET version = 2;
    `);
    for (const table of tables) assert.equal((await db.query(`SELECT * FROM ${table}`)).rows.length, 1);
    for (const table of ['business_signup_applications', 'business_email_verifications', 'business_signup_email_limits']) {
      await db.exec(`DELETE FROM ${table}`);
      assert.equal((await db.query(`SELECT * FROM ${table}`)).rows.length, 0);
    }
    await assert.rejects(db.query('SELECT * FROM _prisma_migrations'), (error: { code?: string }) => error.code === '42501');
    await assert.rejects(db.exec('CREATE TABLE public.api_must_not_create(id text)'), (error: { code?: string }) => error.code === '42501');
    await db.exec('RESET ROLE');
    await db.exec("INSERT INTO business_signup_email_limits VALUES ('owner@example.invalid', now(), now(), 1)");
    for (const role of ['anon', 'authenticated', 'unrelated_app']) {
      await db.exec(`SET ROLE ${role}`);
      for (const table of tables) await assert.rejects(db.query(`SELECT * FROM ${table}`), (error: { code?: string }) => error.code === '42501');
      await db.exec('RESET ROLE');
    }
    await db.exec('GRANT SELECT, INSERT, UPDATE, DELETE ON business_signup_email_limits TO unrelated_app; SET ROLE unrelated_app');
    assert.deepEqual((await db.query('SELECT * FROM business_signup_email_limits')).rows, []);
    await assert.rejects(db.exec("INSERT INTO business_signup_email_limits VALUES ('unrelated@example.invalid', now(), now(), 1)"),
      (error: { code?: string }) => error.code === '42501');
    assert.deepEqual((await db.query('UPDATE business_signup_email_limits SET sent_count = 9 RETURNING *')).rows, []);
    assert.deepEqual((await db.query('DELETE FROM business_signup_email_limits RETURNING *')).rows, []);
    await db.exec('RESET ROLE');
    assert.equal((await db.query<{ sent_count: number }>('SELECT sent_count FROM business_signup_email_limits')).rows[0].sent_count, 1);
  } finally { await db.close(); }
});
