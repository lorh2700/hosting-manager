import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { scopedAssignedPropertyIds } from '../lib/operational-access';

const migration = await readFile(new URL('../prisma/migrations/20261004010000_business_access_settings/migration.sql', import.meta.url), 'utf8');
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, role TEXT NOT NULL);
    CREATE TABLE properties(id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id));
    CREATE TABLE invitations(id TEXT PRIMARY KEY);
    CREATE TABLE user_properties(user_id TEXT REFERENCES users(id) ON DELETE CASCADE, property_id TEXT REFERENCES properties(id) ON DELETE CASCADE, PRIMARY KEY(user_id,property_id));
    INSERT INTO users VALUES ('legacy-admin','admin'),('manager','manager'),('cleaner','cleaner');
    INSERT INTO properties VALUES ('p0','legacy-admin'),('p1','legacy-admin'),('p2','legacy-admin');
    INSERT INTO user_properties VALUES ('manager','p0'),('manager','p1'),('manager','p2');`);
  await db.exec(migration);
  return db;
}

test('actual PostgreSQL migration never promotes legacy administrators and retains activity after actor removal', async () => {
  const db = await fixture();
  try {
    assert.deepEqual((await db.query('SELECT role,enabled_modules,organization_id FROM users WHERE id=$1', ['legacy-admin'])).rows,
      [{ role: 'admin', enabled_modules: null, organization_id: null }]);
    assert.deepEqual((await db.query('SELECT role FROM users WHERE id=$1', ['manager'])).rows, [{ role: 'manager' }]);
    await db.exec(`INSERT INTO audit_logs(id,actor_id,actor_name,action,summary) VALUES ('a','cleaner','청소담당자','complete','청소 완료'); DELETE FROM users WHERE id='cleaner';`);
    assert.deepEqual((await db.query('SELECT actor_id,summary FROM audit_logs WHERE id=$1', ['a'])).rows, [{ actor_id: 'cleaner', summary: '청소 완료' }]);
    await assert.rejects(db.exec(`UPDATE users SET organization_id='missing' WHERE id='manager'`), /foreign key/);
    assert.equal((await db.query<{ relrowsecurity: boolean }>('SELECT relrowsecurity FROM pg_class WHERE relname=$1', ['audit_logs'])).rows[0].relrowsecurity, true);
  } finally { await db.close(); }
});

test('real persisted cross-business assignments and supervisor options are filtered by the authentication scope helper', async () => {
  const db = await fixture();
  try {
    await db.exec(`INSERT INTO organizations(id,name,features) VALUES ('org1','운와들','{"inventory":false}'),('org2','다른 사업자','{}');
      UPDATE users SET organization_id='org1' WHERE id='manager';
      UPDATE properties SET organization_id='org1',feature_overrides='{"inventory":true}' WHERE id='p1';
      UPDATE properties SET organization_id='org2' WHERE id='p2';`);
    const rows = (await db.query<{ propertyId: string; property: { organizationId: string | null; featureOverrides: unknown; organization: { status: string; features: unknown } | null } }>(`
      SELECT up.property_id AS "propertyId", json_build_object('organizationId',p.organization_id,'featureOverrides',p.feature_overrides,'organization',
        CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('status',o.status,'features',o.features) END) AS property
      FROM user_properties up JOIN properties p ON p.id=up.property_id LEFT JOIN organizations o ON o.id=p.organization_id WHERE up.user_id=$1 ORDER BY up.property_id`, ['manager'])).rows;
    assert.deepEqual(scopedAssignedPropertyIds('org1', rows, 'cleaning'), ['p1']);
    assert.deepEqual(scopedAssignedPropertyIds('org1', rows, 'inventory'), []);
    assert.deepEqual(scopedAssignedPropertyIds(null, rows, 'cleaning'), ['p0']);
    await assert.rejects(db.exec(`DELETE FROM organizations WHERE id='org1'`), /foreign key/);
  } finally { await db.close(); }
});
