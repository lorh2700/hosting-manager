import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../prisma/migrations/20261031210000_archive_retired_tables/migration.sql', import.meta.url), 'utf8');
const restore = await readFile(new URL('../scripts/db/restore-retired-tables-20261031.sql', import.meta.url), 'utf8');
const diagnostic = await readFile(new URL('../scripts/check-staff-identity-state.sql', import.meta.url), 'utf8');
const names = ['legacy_cleaners', 'legacy_cleaner_properties', 'staff_identity_users_before', 'organization_pricing_policies', 'rate_setup_checks'];

async function fixture(populated = false) {
  const sql = new PGlite();
  await sql.exec(`
    CREATE ROLE archive_app;
    CREATE TABLE users(id text PRIMARY KEY, owner_id text, public_token text, notify_new_open boolean);
    CREATE TABLE organizations(id text PRIMARY KEY);
    CREATE TABLE cleanings(id text PRIMARY KEY, cleaner_id text CONSTRAINT cleanings_cleaner_id_fkey REFERENCES users(id));
    CREATE TABLE legacy_cleaners(id text PRIMARY KEY, detail text);
    CREATE TABLE legacy_cleaner_properties(id text PRIMARY KEY, cleaner_id text REFERENCES legacy_cleaners(id));
    CREATE TABLE staff_identity_users_before(id text PRIMARY KEY, detail text);
    CREATE TABLE organization_pricing_policies(organization_id text PRIMARY KEY REFERENCES organizations(id), detail text);
    CREATE TABLE rate_setup_checks(id text PRIMARY KEY, organization_id text REFERENCES organizations(id), actor_id text REFERENCES users(id));
    CREATE TABLE staff_identity_map(id text PRIMARY KEY);
    CREATE TABLE staff_user_merge_archive(id text PRIMARY KEY);
    INSERT INTO staff_identity_map VALUES ('kept');
    INSERT INTO staff_user_merge_archive VALUES ('kept');
  `);
  for (const name of names) {
    await sql.exec(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY readable ON ${name} FOR SELECT TO archive_app USING (true);
      GRANT SELECT ON ${name} TO archive_app;`);
  }
  await sql.exec('ALTER TABLE rate_setup_checks FORCE ROW LEVEL SECURITY');
  if (populated) await sql.exec(`
    INSERT INTO users(id) VALUES ('user'); INSERT INTO organizations VALUES ('org');
    INSERT INTO legacy_cleaners VALUES ('cleaner','synthetic fixture');
    INSERT INTO legacy_cleaner_properties VALUES ('scope','cleaner');
    INSERT INTO staff_identity_users_before VALUES ('snapshot','synthetic fixture');
    INSERT INTO organization_pricing_policies VALUES ('org','beds24_direct');
    INSERT INTO rate_setup_checks VALUES ('check','org','user');
  `);
  return sql;
}

async function catalog(sql: PGlite) {
  const tables = (await sql.query(`SELECT c.oid,c.relname,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity
    FROM pg_class c WHERE c.relname=ANY($1::text[]) AND c.relkind='r' ORDER BY c.relname`, [names])).rows;
  const constraints = (await sql.query(`SELECT c.oid,c.conrelid,c.confrelid,c.conname,c.contype
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE t.relname=ANY($1::text[]) ORDER BY c.oid`, [names])).rows;
  const policies = (await sql.query(`SELECT p.oid,p.polname,p.polrelid,p.polroles
    FROM pg_policy p JOIN pg_class t ON t.oid=p.polrelid
    WHERE t.relname=ANY($1::text[]) ORDER BY p.oid`, [names])).rows;
  return { tables, constraints, policies };
}

async function contents(sql: PGlite, schema: string) {
  const result: Record<string, unknown[]> = {};
  for (const name of names) result[name] = (await sql.query(`SELECT * FROM ${schema}.${name} ORDER BY 1`)).rows;
  return result;
}

for (const populated of [false, true]) test(`archive and restoration preserve ${populated ? 'populated' : 'empty'} tables and access metadata`, async () => {
  const sql = await fixture(populated);
  try {
    const before = await catalog(sql);
    const rows = await contents(sql, 'public');
    await sql.exec(migration);
    assert.deepEqual(await catalog(sql), before);
    assert.deepEqual(await contents(sql, 'archive_20261031'), rows);
    assert.equal((await sql.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])", [names])).rows[0].n, 0);
    assert.equal((await sql.query<{ n: number }>("SELECT count(*)::int AS n FROM staff_identity_map UNION ALL SELECT count(*)::int FROM staff_user_merge_archive")).rows.every(row => row.n === 1), true);
    await sql.exec('SET ROLE archive_app');
    try {
      await assert.rejects(sql.query('SELECT * FROM archive_20261031.legacy_cleaners'), (error: { code?: string }) => error.code === '42501');
      const state = (await sql.query<{
        legacy_cleaners_exists: boolean;
        snapshot_exists: boolean;
        archived_staff_tables: string[];
      }>(diagnostic)).rows[0];
      assert.equal(state.legacy_cleaners_exists, true);
      assert.equal(state.snapshot_exists, true);
      assert.deepEqual(state.archived_staff_tables, ['legacy_cleaner_properties', 'legacy_cleaners', 'staff_identity_users_before']);
    } finally { await sql.exec('RESET ROLE'); }
    await sql.exec(restore);
    assert.deepEqual(await catalog(sql), before);
    assert.deepEqual(await contents(sql, 'public'), rows);
    await sql.exec('SET ROLE archive_app');
    try { assert.equal((await sql.query('SELECT * FROM public.legacy_cleaners')).rows.length, populated ? 1 : 0); }
    finally { await sql.exec('RESET ROLE'); }
  } finally { await sql.close(); }
});

const dependencies = [
  ['incoming foreign key', 'CREATE TABLE active_reference(id text REFERENCES legacy_cleaners(id))'],
  ['view', 'CREATE VIEW active_reference AS SELECT id FROM legacy_cleaners'],
  ['materialized view', 'CREATE MATERIALIZED VIEW active_reference AS SELECT id FROM legacy_cleaners'],
  ['function body', "CREATE FUNCTION active_reference() RETURNS bigint LANGUAGE plpgsql AS 'BEGIN RETURN (SELECT count(*) FROM legacy_cleaners); END'"],
  ['parsed function', 'CREATE FUNCTION active_reference() RETURNS bigint LANGUAGE SQL BEGIN ATOMIC SELECT count(*) FROM legacy_cleaners; END'],
  ['trigger', "CREATE FUNCTION archive_trigger() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'; CREATE TRIGGER active_reference BEFORE INSERT ON legacy_cleaners FOR EACH ROW EXECUTE FUNCTION archive_trigger()"],
  ['row security policy', 'CREATE TABLE active_reference(id text); ALTER TABLE active_reference ENABLE ROW LEVEL SECURITY; CREATE POLICY uses_archive ON active_reference USING (EXISTS (SELECT 1 FROM legacy_cleaners))'],
  ['publication', 'CREATE PUBLICATION active_reference FOR TABLE legacy_cleaners'],
] as const;

for (const [kind, setup] of dependencies) test(`archive fails closed for an unexpected ${kind}`, async () => {
  const sql = await fixture(true);
  try {
    await sql.exec(setup);
    const before = await catalog(sql);
    await assert.rejects(sql.exec(migration), /retired_archive_dependency/);
    await sql.exec('ROLLBACK');
    assert.deepEqual(await catalog(sql), before);
    assert.equal((await sql.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname='archive_20261031'")).rows[0].n, 0);
    assert.equal((await sql.query<{ n: number }>('SELECT count(*)::int AS n FROM legacy_cleaners')).rows[0].n, 1);
  } finally { await sql.close(); }
});

test('conflicting archive names, missing sources and inherited schema grants leave sources intact', async () => {
  for (const [setup, error] of [
    ['CREATE SCHEMA archive_20261031; CREATE TABLE archive_20261031.legacy_cleaners(id text)', /retired_archive_target_conflict/],
    ['ALTER TABLE rate_setup_checks RENAME TO missing_source', /retired_archive_source_missing/],
    ['ALTER DEFAULT PRIVILEGES GRANT USAGE ON SCHEMAS TO archive_app', /retired_archive_access_conflict/],
  ] as const) {
    const sql = await fixture(true);
    try {
      await sql.exec(setup);
      const before = await catalog(sql);
      await assert.rejects(sql.exec(migration), error);
      await sql.exec('ROLLBACK');
      assert.deepEqual(await catalog(sql), before);
      assert.equal((await sql.query<{ n: number }>('SELECT count(*)::int AS n FROM public.legacy_cleaners')).rows[0].n, 1);
    } finally { await sql.close(); }
  }
});

test('restoration refuses a conflicting public table without partially moving archives', async () => {
  const sql = await fixture(true);
  try {
    await sql.exec(migration);
    const before = await contents(sql, 'archive_20261031');
    await sql.exec('CREATE TABLE public.rate_setup_checks(id text)');
    await assert.rejects(sql.exec(restore), /retired_restore_target_conflict/);
    await sql.exec('ROLLBACK');
    assert.deepEqual(await contents(sql, 'archive_20261031'), before);
  } finally { await sql.close(); }
});
