import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { updateOrganization } from '../lib/operations-settings-store';
import { prismaOverrides, resetDb } from './stubs/prisma';

type Sql = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
function client(sql: Sql) {
  return {
    organization: {
      findUnique: async ({ where }: any) => (await sql.query('SELECT id,name,status,features,version FROM organizations WHERE id=$1', [where.id])).rows[0] ?? null,
      findUniqueOrThrow: async ({ where }: any) => (await sql.query('SELECT id,name,status,features,version FROM organizations WHERE id=$1', [where.id])).rows[0],
      updateMany: async ({ where, data }: any) => ({ count: (await sql.query('UPDATE organizations SET name=COALESCE($3,name),features=COALESCE($4::jsonb,features),version=version+1 WHERE id=$1 AND version=$2 RETURNING id', [where.id, where.version, data.name ?? null, data.features === undefined ? null : JSON.stringify(data.features)])).rows.length }),
    },
    property: { findMany: async () => [] },
    auditLog: { create: async ({ data }: any) => sql.query('INSERT INTO audit_logs(id,actor_id,actor_name,action,module,target_type,target_id,organization_id,summary,outcome,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)', [randomUUID(), data.actorId, data.actorName, data.action, data.module, data.targetType, data.targetId, data.organizationId, data.summary, data.outcome, JSON.stringify(data.details)]) },
  };
}
test('local PostgreSQL business migration preserves roles, rejects orphan scope and retains immutable server-only audit records', async () => {
  resetDb(); const sql = new PGlite();
  try {
    await sql.exec("CREATE TABLE users(id TEXT PRIMARY KEY, role TEXT NOT NULL); CREATE TABLE invitations(id TEXT PRIMARY KEY); CREATE TABLE properties(id TEXT PRIMARY KEY); CREATE ROLE anon; CREATE ROLE authenticated; INSERT INTO users VALUES('legacy','admin'),('manager','manager'); INSERT INTO properties VALUES('existing');");
    await sql.exec(await readFile(new URL('../prisma/migrations/20261004010000_business_access_settings/migration.sql', import.meta.url), 'utf8'));
    assert.equal((await sql.query<{ role: string }>('SELECT role FROM users WHERE id=$1', ['legacy'])).rows[0].role, 'admin'); assert.equal((await sql.query<{ role: string }>('SELECT role FROM users WHERE id=$1', ['manager'])).rows[0].role, 'manager');
    const oldProperty = (await sql.query('SELECT organization_id,feature_overrides,feature_version FROM properties')).rows[0]; assert.deepEqual(oldProperty, { organization_id: null, feature_overrides: {}, feature_version: 1 });
    await assert.rejects(sql.query('UPDATE users SET organization_id=$1 WHERE id=$2', ['unknown', 'manager']), /foreign key/);
    await sql.exec("INSERT INTO organizations(id,name) VALUES('o1','원본'); UPDATE users SET organization_id='o1' WHERE id='manager';");
    await assert.rejects(sql.query('DELETE FROM organizations WHERE id=$1', ['o1']), /foreign key/);
    for (const role of ['anon', 'authenticated']) { await sql.exec(`SET ROLE ${role}`); for (const table of ['organizations', 'audit_logs', 'property_requests']) await assert.rejects(sql.query(`SELECT * FROM ${table}`), /permission denied/); await sql.exec('RESET ROLE'); }

    prismaOverrides.$transaction = (run: (tx: ReturnType<typeof client>) => Promise<unknown>) => sql.transaction(tx => run(client(tx)));
    const actor: any = { role: 'super_admin', session: { userId: 'legacy' }, user: { id: 'legacy', displayName: '관리자', organizationId: null } };
    const competing = await Promise.allSettled([updateOrganization(actor, 'o1', { version: 1, name: '변경1' }), updateOrganization(actor, 'o1', { version: 1, name: '변경2' })]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1); assert.equal(competing.filter(result => result.status === 'rejected').length, 1); assert.equal((await sql.query<{ version: number }>('SELECT version FROM organizations')).rows[0].version, 2); assert.equal((await sql.query<{ count: number }>('SELECT count(*)::int AS count FROM audit_logs')).rows[0].count, 1);
    await assert.rejects(sql.query('UPDATE audit_logs SET summary=$1', ['변조']), /immutable/); await assert.rejects(sql.query('DELETE FROM audit_logs'), /immutable/);

    await sql.exec("CREATE FUNCTION reject_test_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END; $$; CREATE TRIGGER reject_test_activity BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_test_activity();");
    const before = (await sql.query('SELECT name,version FROM organizations')).rows[0]; await assert.rejects(updateOrganization(actor, 'o1', { version: 2, name: '롤백되어야 함' }), /audit failure/); assert.deepEqual((await sql.query('SELECT name,version FROM organizations')).rows[0], before);
  } finally { resetDb(); await sql.close(); }
});
