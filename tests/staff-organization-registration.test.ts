import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET as STAFF, POST as CREATE_STAFF } from '../app/api/staff/route';
import { GET as USERS, POST as CREATE_USER } from '../app/api/users/route';
import { GET as ORGANIZATIONS } from '../app/api/admin/organizations/route';
import { db, resetDb, calls } from './stubs/prisma';
import { actAsAdmin, actAsBusinessAdmin, actAsManager, authState } from './stubs/auth';
import { callRoute } from './helpers/beds24-mock';

const request = (path: string, body?: unknown) => new Request(`http://localhost${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const staffBody = { name: '청소직원', phone: '01012345678', mode: 'none', propertyIds: [], loginEnabled: false, notifyNewOpen: false };
beforeEach(() => { resetDb(); actAsAdmin(); db.organization = [{ id: 'o1', name: '사업자1', status: 'active', features: {}, version: 1 }, { id: 'o2', name: '사업자2', status: 'active', features: {}, version: 1 }]; db.property = [{ id: 'p1', name: '첫 지점', organizationId: 'o1' }, { id: 'p2', name: '다른 지점', organizationId: 'o2' }]; });

test('supervisor can register an unassigned cleaner in a selected business', async () => { const result = await callRoute(CREATE_STAFF, request('/api/staff', { ...staffBody, organizationId: 'o1' })); assert.equal(result.status, 201); assert.equal(db.user[0].organizationId, 'o1'); assert.equal((db.userProperty ?? []).length, 0); });
test('all-property cleaner registration uses only the selected business', async () => { const result = await callRoute(CREATE_STAFF, request('/api/staff', { ...staffBody, organizationId: 'o1', mode: 'all' })); assert.equal(result.status, 201); assert.deepEqual(db.userProperty.map(row => row.propertyId), ['p1']); assert.equal(db.user[0].organizationId, 'o1'); });
test('business administrators cannot choose a foreign business or staff property', async () => { actAsBusinessAdmin('o1', ['p1']); assert.equal((await callRoute(CREATE_STAFF, request('/api/staff', { ...staffBody, organizationId: 'o2' }))).status, 403); assert.equal((await callRoute(CREATE_STAFF, request('/api/staff', { ...staffBody, mode: 'selected', propertyIds: ['p2'] }))).status, 403); const result = await callRoute(CREATE_STAFF, request('/api/staff', staffBody)); assert.equal(result.status, 201); assert.equal(db.user[0].organizationId, 'o1'); });
test('supervisor cannot register a cleaner with mismatched business properties', async () => { assert.equal((await callRoute(CREATE_STAFF, request('/api/staff', { ...staffBody, organizationId: 'o1', mode: 'selected', propertyIds: ['p2'] }))).status, 400); assert.equal((db.user ?? []).length, 0); });
test('shared cleaners do not expose a schedule token to a manager with partial scope', async () => {
  actAsManager(['p1']); authState.auth.user.organizationId = 'o1';
  db.user = [{ id: 'host-1', role: 'manager', organizationId: 'o1', email: 'manager@example.com', publicToken: 'own-token' }, { id: 'shared', role: 'cleaner', organizationId: 'o1', email: 'shared@example.com', publicToken: 'all-properties-token', ownerId: 'host-1' }]; db.property.push({ id: 'p3', name: '같은사업자 다른지점', organizationId: 'o1' }); db.userProperty = [{ userId: 'host-1', propertyId: 'p1' }, { userId: 'shared', propertyId: 'p1' }, { userId: 'shared', propertyId: 'p3' }];
  const result = await callRoute(STAFF, request('/api/staff')); assert.equal(result.status, 200); assert.equal(result.body.staff.find((item: any) => item.userId === 'host-1').publicToken, 'own-token'); assert.equal(result.body.staff.find((item: any) => item.userId === 'shared').publicToken, null); assert.equal(JSON.stringify(result.body).includes('all-properties-token'), false);
});
test('user registration and listing include business identity and a version without credentials', async () => {
  const result = await callRoute(CREATE_USER, request('/api/users', { displayName: '매니저', email: 'new@example.com', password: 'valid-password', phone: '01012345678', role: 'manager', organizationId: 'o1', propertyIds: ['p1'] })); assert.equal(result.status, 201); assert.equal(result.body.organizationId, 'o1'); assert.equal(result.body.version, 1);
  const listed = await callRoute(USERS, request('/api/users')); assert.equal(listed.body[0].organizationId, 'o1'); assert.equal(listed.body[0].version, 1); assert.equal(listed.body[0].password, undefined);
});
test('organization picker query does not load every user account', async () => { calls.length = 0; const result = await callRoute(ORGANIZATIONS, request('/api/admin/organizations')); assert.equal(result.status, 200); assert.equal(calls.includes('user.findMany'), false); });
