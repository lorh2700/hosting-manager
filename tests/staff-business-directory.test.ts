import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET as STAFF } from '../app/api/staff/route';
import { STAFF_PLATFORM_SCOPE, STAFF_UNASSIGNED_SCOPE, staffOrganizationKey, staffOrganizationName } from '../lib/staff-organizations';
import { db, resetDb, calls } from './stubs/prisma';
import { actAsAdmin, actAsBusinessAdmin, actAsManager, actAsCleaner, authState } from './stubs/auth';
import { callRoute } from './helpers/beds24-mock';

const request = (scope?: string, picker = false) => new Request(`http://localhost/api/staff?${new URLSearchParams({ ...(scope ? { organizationId: scope } : {}), ...(picker ? { picker: '1' } : {}) })}`);

beforeEach(() => {
  resetDb(); actAsAdmin();
  db.organization = [{ id: 'o1', name: '주식회사 운와들', status: 'active' }, { id: 'o2', name: '다른 사업자', status: 'inactive' }];
  db.property = [{ id: 'p1', name: '안온재', organizationId: 'o1' }, { id: 'p2', name: '다른 지점', organizationId: 'o2' }, { id: 'p3', name: '미배정 지점', organizationId: null }, { id: 'p4', name: '운와당', organizationId: 'o1' }];
  db.user = [
    { id: 'admin-1', role: 'super_admin', organizationId: null, displayName: '슈퍼매니저', email: 'super@example.com', password: 'secret-super', publicToken: 'super-token' },
    { id: 'business-admin-1', role: 'admin', organizationId: 'o1', displayName: '운와 관리자', email: 'admin@example.com', password: 'secret-admin', publicToken: 'admin-token' },
    { id: 'host-1', role: 'manager', organizationId: 'o1', displayName: '운와 매니저', email: 'manager@example.com', publicToken: 'own-token' },
    { id: 'shared', role: 'cleaner', organizationId: 'o1', displayName: '공동 청소 직원', email: 'shared@example.com', ownerId: 'host-1', publicToken: 'shared-private-token' },
    { id: 'foreign', role: 'cleaner', organizationId: 'o2', displayName: '다른 사업자 직원', email: 'foreign@example.com', publicToken: 'foreign-private-token' },
    { id: 'legacy', role: 'admin', organizationId: null, displayName: '미배정 관리자', email: 'legacy@example.com', publicToken: 'legacy-token' },
  ];
  db.userProperty = [{ userId: 'host-1', propertyId: 'p1' }, { userId: 'shared', propertyId: 'p1' }, { userId: 'shared', propertyId: 'p4' }, { userId: 'foreign', propertyId: 'p2' }, { userId: 'foreign', propertyId: 'p1' }, { userId: 'legacy', propertyId: 'p3' }];
});

test('staff directory returns exact business names and separates platform and unassigned administrators without credentials', async () => {
  const result = await callRoute(STAFF, request()); assert.equal(result.status, 200);
  const staff = result.body.staff;
  assert.equal(staff.find((item: { userId: string }) => item.userId === 'host-1').organizationName, '주식회사 운와들');
  assert.equal(staff.find((item: { userId: string }) => item.userId === 'admin-1').organizationName, '전체 사업자 관리');
  assert.equal(staff.find((item: { userId: string }) => item.userId === 'legacy').organizationName, '사업자 미배정');
  assert.deepEqual(result.body.organizations.map((item: { id: string }) => item.id).sort(), ['o1', 'o2']);
  assert.equal(JSON.stringify(result.body).includes('secret-'), false);
});

test('supervisor organization filter limits both staff and property queries to the selected business', async () => {
  const result = await callRoute(STAFF, request('o1')); assert.equal(result.status, 200);
  assert.deepEqual(result.body.staff.map((item: { userId: string }) => item.userId).sort(), ['business-admin-1', 'host-1', 'shared']);
  assert.deepEqual(result.body.properties.map((item: { id: string }) => item.id).sort(), ['p1', 'p4']);
  assert.equal(JSON.stringify(result.body.staff).includes('foreign-private-token'), false);
  const stopped = await callRoute(STAFF, request('o2')); assert.equal(stopped.status, 200); assert.deepEqual(stopped.body.staff.map((item: { userId: string }) => item.userId), ['foreign']);
});

test('unassigned filter excludes platform administrators and the platform filter returns no business properties', async () => {
  const unassigned = await callRoute(STAFF, request(STAFF_UNASSIGNED_SCOPE)); assert.equal(unassigned.status, 200);
  assert.deepEqual(unassigned.body.staff.map((item: { userId: string }) => item.userId), ['legacy']);
  assert.deepEqual(unassigned.body.properties.map((item: { id: string }) => item.id), ['p3']);
  const platform = await callRoute(STAFF, request(STAFF_PLATFORM_SCOPE)); assert.equal(platform.status, 200);
  assert.deepEqual(platform.body.staff.map((item: { userId: string }) => item.userId), ['admin-1']); assert.deepEqual(platform.body.properties, []);
});

test('business administrator cannot widen tenant through a foreign, unassigned, or platform scope', async () => {
  actAsBusinessAdmin('o1', ['p1', 'p4']);
  for (const scope of ['o2', STAFF_UNASSIGNED_SCOPE, STAFF_PLATFORM_SCOPE]) {
    calls.length = 0; const result = await callRoute(STAFF, request(scope)); assert.equal(result.status, 403);
    assert.equal(calls.includes('organization.findMany'), false); assert.equal(calls.includes('user.findMany'), false);
  }
  const result = await callRoute(STAFF, request('o1')); assert.equal(result.status, 200);
  assert.deepEqual(result.body.organizations, [{ id: 'o1', name: '주식회사 운와들', status: 'active' }]);
  assert.ok(result.body.staff.every((item: { organizationId: string }) => item.organizationId === 'o1'));
  assert.equal(JSON.stringify(result.body).includes('다른 사업자'), false); assert.equal(JSON.stringify(result.body).includes('foreign-private-token'), false);
});

test('manager sees only its business identity and cannot obtain full schedule token from a partially shared cleaner', async () => {
  actAsManager(['p1']); authState.auth.user.organizationId = 'o1';
  const result = await callRoute(STAFF, request()); assert.equal(result.status, 200);
  assert.deepEqual(result.body.organizations.map((item: { id: string }) => item.id), ['o1']);
  assert.deepEqual(result.body.properties.map((item: { id: string }) => item.id), ['p1']);
  assert.equal(result.body.staff.find((item: { userId: string }) => item.userId === 'host-1').publicToken, 'own-token');
  assert.equal(result.body.staff.find((item: { userId: string }) => item.userId === 'shared').publicToken, null);
  assert.equal(JSON.stringify(result.body).includes('shared-private-token'), false);
  assert.equal(JSON.stringify(result.body).includes('foreign-private-token'), false);
  assert.equal((await callRoute(STAFF, request('o2'))).status, 403);
});

test('unassigned business administrator still sees only their own record', async () => {
  actAsBusinessAdmin(null); authState.auth.user.id = 'legacy'; authState.auth.session.userId = 'legacy';
  const result = await callRoute(STAFF, request(STAFF_UNASSIGNED_SCOPE)); assert.equal(result.status, 200);
  assert.deepEqual(result.body.staff.map((item: { userId: string }) => item.userId), ['legacy']);
  assert.deepEqual(result.body.organizations, []); assert.deepEqual(result.body.properties, []);
});

test('registration picker returns business and branch metadata without loading staff accounts or tokens', async () => {
  calls.length = 0; const result = await callRoute(STAFF, request(undefined, true)); assert.equal(result.status, 200);
  assert.equal(calls.includes('user.findMany'), false); assert.deepEqual(result.body.staff, []);
  assert.equal(result.body.properties.length, 4); assert.equal(result.body.organizations.length, 2);
  assert.equal(JSON.stringify(result.body).includes('token'), false);
});

test('unknown company and cleaner callers cannot retrieve staff records', async () => {
  const unknown = await callRoute(STAFF, request('missing')); assert.equal(unknown.status, 400);
  assert.equal(calls.includes('user.findMany'), false);
  actAsCleaner(['p1']); assert.equal((await callRoute(STAFF, request())).status, 403);
});

test('business label and grouping keep platform, unassigned, and missing business records distinct', () => {
  assert.equal(staffOrganizationKey({ role: 'super_admin', organizationId: null }), STAFF_PLATFORM_SCOPE);
  assert.equal(staffOrganizationKey({ role: 'admin', organizationId: null }), STAFF_UNASSIGNED_SCOPE);
  assert.equal(staffOrganizationKey({ role: 'cleaner', organizationId: 'o1' }), 'o1');
  assert.equal(staffOrganizationName({ role: 'super_admin', organizationId: 'o1' }), '전체 사업자 관리');
  assert.equal(staffOrganizationName({ role: 'admin', organizationId: null, organizationName: '과거 사업자' }), '사업자 미배정');
  assert.equal(staffOrganizationName({ role: 'cleaner', organizationId: 'missing' }), '사업자 정보 확인 필요');
});
