import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getOperationsSettings, listOrganizations, listPropertyRequests, updateOrganization, decidePropertyRequest } from '../lib/operations-settings-store';
import { GET as SETTINGS } from '../app/api/admin/operations-settings/route';
import { GET as ORGANIZATIONS } from '../app/api/admin/organizations/route';
import { GET as REQUESTS } from '../app/api/admin/property-requests/route';
import { db, calls, resetDb, prismaOverrides } from './stubs/prisma';
import { actAsAdmin, actAsBusinessAdmin, authState } from './stubs/auth';

const request = (path: string) => new Request(`http://localhost/api/admin/${path}`);
const context = () => ({ params: Promise.resolve({}) });
const rejectedWith = (status: number) => (error: any) => error.status === status;
const rows = (model: string) => structuredClone(db[model] ?? []);
const state = () => ({ organizations: rows('organization'), properties: rows('property'), users: rows('user'), assignments: rows('userProperty'), cleanings: rows('cleaning'), audits: rows('auditLog') });
const organization = (id: string) => db.organization.find(row => row.id === id)!;
const user = (id: string) => db.user.find(row => row.id === id)!;
beforeEach(() => {
  resetDb(); actAsAdmin();
  db.organization = ['o1', 'o2', 'o3'].map(id => ({ id, name: id, status: 'active', features: {}, version: 1 }));
  db.property = [{ id: 'p1', name: '원 지점1', organizationId: 'o1', featureOverrides: { laundry: false }, featureVersion: 1 }, { id: 'p2', name: '원 지점2', organizationId: 'o1', featureOverrides: {}, featureVersion: 1 }, { id: 'p3', name: '대상 지점', organizationId: 'o2', featureOverrides: {}, featureVersion: 1 }, { id: 'p4', name: '미소속 지점', organizationId: null, featureOverrides: {}, featureVersion: 1 }];
  db.user = [{ id: 'admin-1', email: 'super@example.com', role: 'super_admin', status: 'active', organizationId: null, accessVersion: 1 }, { id: 'business-admin-1', email: 'business@example.com', role: 'admin', status: 'active', organizationId: 'o1', accessVersion: 1 }, { id: 'manager', displayName: '매니저', email: 'manager@example.com', role: 'manager', status: 'active', organizationId: 'o1', enabledModules: ['cleaning', 'inventory'], publicToken: 'manager-before', accessVersion: 1 }, { id: 'cleaner', displayName: '청소 직원', role: 'cleaner', status: 'no_account', organizationId: 'o1', enabledModules: ['cleaning'], publicToken: 'cleaner-before', accessVersion: 4 }];
  db.userProperty = [{ userId: 'manager', propertyId: 'p1' }, { userId: 'manager', propertyId: 'p2' }, { userId: 'cleaner', propertyId: 'p1' }];
  db.cleaning = [{ id: 'historical', propertyId: 'p1', cleanerId: 'cleaner', status: 'done' }];
});

test('설정 목록을 사업자로 좁히면 타 사업자 2000건 초과 기록과 분리하여 조회하고 미소속 필터도 지원한다', async () => {
  const foreign = Array.from({ length: 2001 }, (_, index) => ({ id: `foreign-${index}`, organizationId: 'o3', name: '타 지점', role: 'manager', displayName: '타 직원' }));
  db.property.push(...foreign); db.user.push(...foreign);
  const scoped: any = await SETTINGS(request('operations-settings?organizationId=o1'), context());
  assert.equal(scoped.status, 200); assert.deepEqual(scoped.body.properties.map((row: any) => row.id).sort(), ['p1', 'p2']);
  assert.deepEqual(scoped.body.users.map((row: any) => row.id).sort(), ['business-admin-1', 'cleaner', 'manager']); assert.equal(scoped.body.users.some((row: any) => row.id.startsWith('foreign')), false);
  const unassigned: any = await SETTINGS(request('operations-settings?organizationId=__unassigned__'), context());
  assert.equal(unassigned.status, 200); assert.deepEqual(unassigned.body.properties.map((row: any) => row.id), ['p4']); assert.deepEqual(unassigned.body.users.map((row: any) => row.id), ['admin-1']);
  assert.equal((await SETTINGS(request('operations-settings'), context()) as any).status, 400);
});

test('사업자 선택 목록은 지점 대량조회 없이 호출되며 사업자 관리자에게 타 사업자 필터를 허용하지 않는다', async () => {
  db.property.push(...Array.from({ length: 2001 }, (_, i) => ({ id: `foreign-${i}`, organizationId: 'o3' })));
  const picker: any = await ORGANIZATIONS(request('organizations?picker=1'), context());
  assert.equal(picker.status, 200); assert.equal(picker.body.organizations.length, 3); assert.equal(calls.includes('property.findMany'), false);
  actAsBusinessAdmin('o1'); const own = await getOperationsSettings(authState.auth, request('operations-settings?organizationId=o1'));
  assert.deepEqual(own.organizations.map(row => row.id), ['o1']);
  await assert.rejects(getOperationsSettings(authState.auth, request('operations-settings?organizationId=o2')), rejectedWith(403));
  assert.deepEqual((await listOrganizations(authState.auth, request('organizations?picker=1'))).map(row => row.id), ['o1']);
});

test('추가 지점 요청은 상태와 사업자부터 제한한 후 같은 시각 205건도 커서로 빠짐없이 조회한다', async () => {
  const at = '2026-10-04T01:00:00Z';
  db.propertyRequest = Array.from({ length: 205 }, (_, i) => ({ id: `r${String(i).padStart(3, '0')}`, organizationId: 'o1', name: '대기 지점', status: 'requested', createdAt: new Date(at) }));
  db.propertyRequest.push(...Array.from({ length: 150 }, (_, i) => ({ id: `approved-${i}`, organizationId: 'o1', status: 'approved', createdAt: new Date('2026-10-05T01:00:00Z') })), ...Array.from({ length: 150 }, (_, i) => ({ id: `foreign-${i}`, organizationId: 'o2', status: 'requested', createdAt: new Date('2026-10-05T02:00:00Z') })));
  actAsBusinessAdmin('o1'); const ids: string[] = []; let cursor: string | null = null; const sizes: number[] = [];
  do {
    const page: any = await REQUESTS(request(`property-requests?status=requested${cursor ? `&cursor=${cursor}` : ''}`), context());
    assert.equal(page.status, 200); assert.ok(page.body.items.every((row: any) => row.organizationId === 'o1' && row.status === 'requested'));
    sizes.push(page.body.items.length); ids.push(...page.body.items.map((row: any) => row.id)); cursor = page.body.nextCursor;
    assert.equal(page.body.hasMore, Boolean(cursor));
  } while (cursor);
  assert.deepEqual(sizes, [100, 100, 5]); assert.equal(new Set(ids).size, 205); assert.deepEqual(ids, Array.from({ length: 205 }, (_, i) => `r${String(204 - i).padStart(3, '0')}`));
});

test('추가 지점 요청 조회는 잘못된 커서·상태와 사업자 관리자 타 사업자 조회를 거부한다', async () => {
  for (const query of ['cursor=not-json', 'cursor=' + Buffer.from(JSON.stringify({ createdAt: 'invalid', id: 'r1' })).toString('base64url'), 'status=all']) await assert.rejects(listPropertyRequests(authState.auth, request(`property-requests?${query}`)), rejectedWith(400));
  actAsBusinessAdmin('o1'); await assert.rejects(listPropertyRequests(authState.auth, request('property-requests?organizationId=o2')), rejectedWith(403));
});

test('지점 전체와 담당 직원 일괄 이관은 기록·배정·메뉴·계정 상태를 보존하고 이전 링크를 회수한다', async () => {
  const assignments = rows('userProperty'); const historical = rows('cleaning');
  const result = await updateOrganization(authState.auth, 'o2', { version: 1, propertyIds: ['p1', 'p2', 'p3'], migrateAssignedUsers: true });
  assert.deepEqual(result.propertyIds, ['p1', 'p2', 'p3']); assert.equal(db.property.find(row => row.id === 'p1')!.organizationId, 'o2'); assert.deepEqual(db.property.find(row => row.id === 'p1')!.featureOverrides, { laundry: false });
  for (const id of ['manager', 'cleaner']) { assert.equal(user(id).organizationId, 'o2'); assert.notEqual(user(id).publicToken, `${id}-before`); }
  assert.equal(user('manager').accessVersion, 2); assert.equal(user('cleaner').accessVersion, 5); assert.equal(user('cleaner').status, 'no_account'); assert.deepEqual(user('manager').enabledModules, ['cleaning', 'inventory']);
  assert.deepEqual(db.userProperty, assignments); assert.deepEqual(db.cleaning, historical); assert.equal(organization('o1').version, 2); assert.equal(organization('o2').version, 2); assert.equal(organization('o3').version, 1);
  assert.equal(db.auditLog.filter(row => row.action === 'user.organization.move').length, 2); assert.equal(db.auditLog.filter(row => row.action === 'property.organization.move' && row.organizationId === 'o1').length, 2);
});

test('직원의 담당 지점을 일부만 이동하면 앞서 처리한 다른 직원까지 변경 없이 409로 롤백한다', async () => {
  db.user = [user('cleaner'), user('manager'), ...db.user.filter(row => !['cleaner', 'manager'].includes(row.id))];
  const before = state();
  await assert.rejects(updateOrganization(authState.auth, 'o2', { version: 1, propertyIds: ['p1', 'p3'], migrateAssignedUsers: true }), rejectedWith(409));
  assert.deepEqual(state(), before);
});

test('명시적 일괄 이관 없이 배정 지점을 이동하거나 타 사업자 관리자를 함께 이동하면 409로 거부한다', async () => {
  const before = state(); await assert.rejects(updateOrganization(authState.auth, 'o2', { version: 1, propertyIds: ['p1', 'p2', 'p3'] }), rejectedWith(409)); assert.deepEqual(state(), before);
  db.userProperty.push({ userId: 'business-admin-1', propertyId: 'p1' }); const withAdmin = state();
  await assert.rejects(updateOrganization(authState.auth, 'o2', { version: 1, propertyIds: ['p1', 'p2', 'p3'], migrateAssignedUsers: true }), rejectedWith(409)); assert.deepEqual(state(), withAdmin);
});

function addUnassignedAdministrator() {
  db.user.push({ id: 'legacy-admin', displayName: '기존 관리자', email: 'legacy@example.invalid', role: 'admin', status: 'active', organizationId: null, enabledModules: null, password: 'original-hash', publicToken: 'legacy-before', accessVersion: 3 });
  db.userProperty.push({ userId: 'legacy-admin', propertyId: 'p4' });
}

test('슈퍼매니저는 미배정 관리자와 숙소를 함께 연결하고 기존 역할·배정·계정 정보를 보존한다', async () => {
  addUnassignedAdministrator();
  db.user.push({ id: 'unrelated-admin', role: 'admin', status: 'active', organizationId: null, accessVersion: 1 });
  db.userProperty.push({ userId: 'admin-1', propertyId: 'p4' });
  const assignments = rows('userProperty'); const historical = rows('cleaning');
  await updateOrganization(authState.auth, 'o2', { version: 1, propertyIds: ['p3', 'p4'], migrateAssignedUsers: true });
  const moved = user('legacy-admin');
  assert.equal(moved.organizationId, 'o2'); assert.equal(moved.role, 'admin'); assert.equal(moved.status, 'active');
  assert.equal(moved.password, 'original-hash'); assert.equal(moved.enabledModules, null); assert.equal(moved.accessVersion, 4);
  assert.notEqual(moved.publicToken, 'legacy-before'); assert.deepEqual(db.userProperty, assignments); assert.deepEqual(db.cleaning, historical);
  assert.equal(user('unrelated-admin').organizationId, null); assert.equal(user('admin-1').organizationId, null);
  const audit = db.auditLog.find(row => row.targetId === 'legacy-admin');
  assert.equal(audit.action, 'user.organization.move'); assert.equal(audit.organizationId, 'o2'); assert.match(audit.summary, /미배정 관리자/);
  assert.equal(JSON.stringify(db.auditLog).includes('original-hash'), false); assert.equal(JSON.stringify(db.auditLog).includes(moved.publicToken), false);
  actAsBusinessAdmin('o2');
  const after = await getOperationsSettings(authState.auth);
  assert.deepEqual(after.properties.map(property => property.id).sort(), ['p3', 'p4']);
});

test('미배정 관리자에게 남은 지점 배정이 있으면 첫 사업자 연결도 모두 롤백한다', async () => {
  addUnassignedAdministrator();
  db.property.push({ id: 'p5', name: '다른 미배정 지점', organizationId: null, featureOverrides: {}, featureVersion: 1 });
  db.userProperty.push({ userId: 'legacy-admin', propertyId: 'p5' });
  const before = state();
  await assert.rejects(updateOrganization(authState.auth, 'o2', { version: 1, propertyIds: ['p1', 'p2', 'p3', 'p4'], migrateAssignedUsers: true }), rejectedWith(409));
  assert.deepEqual(state(), before);
});

test('함께 이동을 선택하지 않으면 미배정 관리자의 소속을 자동 변경하지 않는다', async () => {
  addUnassignedAdministrator(); const before = structuredClone(user('legacy-admin'));
  await updateOrganization(authState.auth, 'o2', { version: 1, propertyIds: ['p3', 'p4'], migrateAssignedUsers: false });
  assert.deepEqual(user('legacy-admin'), before);
  assert.equal(db.auditLog.some(row => row.action === 'user.organization.move'), false);
});

test('사업자 관리자는 미배정 관리자·숙소의 최초 연결도 직접 수행할 수 없다', async () => {
  addUnassignedAdministrator(); const before = state(); actAsBusinessAdmin('o2');
  await assert.rejects(updateOrganization(authState.auth, 'o2', { version: 1, propertyIds: ['p3', 'p4'], migrateAssignedUsers: true }), rejectedWith(403));
  assert.deepEqual(state(), before);
});

test('미배정 관리자 이동 이력 저장이 실패하면 관리자 소속·토큰과 숙소 변경도 복구한다', async () => {
  addUnassignedAdministrator(); const before = state();
  prismaOverrides.auditLog = { create: async () => { throw new Error('audit offline'); } };
  await assert.rejects(updateOrganization(authState.auth, 'o2', { version: 1, propertyIds: ['p3', 'p4'], migrateAssignedUsers: true }), /audit offline/);
  assert.deepEqual(state(), before);
});

test('미배정 관리자를 먼저 처리한 뒤 타 사업자 관리자를 만나도 앞선 이동을 모두 복구한다', async () => {
  addUnassignedAdministrator();
  db.user = [user('legacy-admin'), ...db.user.filter(row => row.id !== 'legacy-admin')];
  db.userProperty.push({ userId: 'business-admin-1', propertyId: 'p1' });
  const before = state();
  await assert.rejects(updateOrganization(authState.auth, 'o2', { version: 1, propertyIds: ['p1', 'p2', 'p3', 'p4'], migrateAssignedUsers: true }), /다른 사업자에 소속된 관리자/);
  assert.deepEqual(state(), before);
});

test('여러 원사업자의 지점을 이동해도 원사업자 버전은 각각 한 번 증가하고 오래된 원사업자 저장을 막는다', async () => {
  db.property.push({ id: 'p5', organizationId: 'o3', featureVersion: 1 });
  await updateOrganization(authState.auth, 'o2', { version: 1, propertyIds: ['p1', 'p2', 'p3', 'p5'], migrateAssignedUsers: true });
  for (const id of ['o1', 'o2', 'o3']) assert.equal(organization(id).version, 2);
  const before = state(); await assert.rejects(updateOrganization(authState.auth, 'o1', { version: 1, propertyIds: ['p1', 'p2'] }), rejectedWith(409)); assert.deepEqual(state(), before);
});

test('일괄 이동의 마지막 활동 저장이 실패해도 직원·지점·원사업자 버전·토큰을 모두 복구한다', async () => {
  let writes = 0;
  prismaOverrides.auditLog = { create: async ({ data }: any) => { if (++writes === 5) throw new Error('audit offline'); (db.auditLog ??= []).push({ id: `audit-${writes}`, ...data }); return data; } };
  const before = state(); await assert.rejects(updateOrganization(authState.auth, 'o2', { version: 1, propertyIds: ['p1', 'p2', 'p3'], migrateAssignedUsers: true }), /audit offline/); assert.equal(writes, 5); assert.deepEqual(state(), before);
});

test('동시에 동일 버전으로 이관해도 한 번만 저장하고 실패한 요청이 성공한 상태를 되돌리지 않는다', async () => {
  const auth = authState.auth;
  const results = await Promise.allSettled([updateOrganization(auth, 'o2', { version: 1, propertyIds: ['p1', 'p2', 'p3'], migrateAssignedUsers: true }), updateOrganization(auth, 'o2', { version: 1, propertyIds: ['p1', 'p2', 'p3'], migrateAssignedUsers: true })]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); const failed = results.find(row => row.status === 'rejected') as PromiseRejectedResult; assert.equal(failed.reason.status, 409);
  assert.equal(organization('o2').version, 2); assert.equal(organization('o1').version, 2); assert.equal(user('manager').accessVersion, 2); assert.equal(user('cleaner').accessVersion, 5); assert.equal(user('cleaner').organizationId, 'o2'); assert.equal(db.auditLog.length, 5);
});

test('지점 요청 승인은 공개 준비 전 상태로 생성하며 요청자 소속 변경 또는 로그 실패 시 생성과 승인을 함께 취소한다', async () => {
  db.propertyRequest = [{ id: 'r1', organizationId: 'o1', name: '새 지점', requestedBy: 'business-admin-1', status: 'requested', version: 1 }];
  user('business-admin-1').organizationId = 'o2';
  await assert.rejects(decidePropertyRequest(authState.auth, 'r1', { version: 1, status: 'approved' }), rejectedWith(409)); assert.equal(db.propertyRequest[0].status, 'requested'); assert.equal(db.property.length, 4);
  user('business-admin-1').organizationId = 'o1'; prismaOverrides.auditLog = { create: async () => { throw new Error('audit offline'); } };
  await assert.rejects(decidePropertyRequest(authState.auth, 'r1', { version: 1, status: 'approved' }), /audit offline/); assert.equal(db.propertyRequest[0].status, 'requested'); assert.equal(db.property.length, 4);
  delete prismaOverrides.auditLog; const result = await decidePropertyRequest(authState.auth, 'r1', { version: 1, status: 'approved' });
  const added = db.property.find(row => row.id === result.propertyId)!; assert.equal(added.status, 'coming_soon'); assert.deepEqual(added.publicInfo, {}); assert.equal(added.organizationId, 'o1'); assert.equal(db.propertyRequest[0].version, 2);
});
