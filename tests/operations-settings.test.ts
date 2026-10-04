import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET as SETTINGS, PUT as SAVE } from '../app/api/admin/operations-settings/route';
import { POST as ORGANIZATION } from '../app/api/admin/organizations/route';
import { PATCH as ORGANIZATION_PATCH } from '../app/api/admin/organizations/[id]/route';
import { POST as INVITE } from '../app/api/admin/organizations/[id]/invite/route';
import { PATCH as USER_ACCESS } from '../app/api/admin/user-access/[id]/route';
import { GET as ACTIVITY } from '../app/api/admin/activity/route';
import { GET as REQUESTS, POST as REQUEST } from '../app/api/admin/property-requests/route';
import { PATCH as DECIDE } from '../app/api/admin/property-requests/[id]/route';
import { db, resetDb, prismaOverrides, calls } from './stubs/prisma';
import { actAsAdmin, actAsBusinessAdmin, actAsManager, actAsCleaner, actAsAnonymous } from './stubs/auth';

const request = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => new Request(`http://localhost/api/admin/${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
async function invoke(route: any, path: string, body?: unknown, id?: string, method?: string) { const response = await route(request(path, body, method), id ? { params: Promise.resolve({ id }) } : undefined); return { status: response.status, body: response.body }; }
beforeEach(() => {
  resetDb(); actAsAdmin();
  db.organization = [{ id: 'o1', name: '사업자1', status: 'active', features: { priceLabs: false }, version: 1 }, { id: 'o2', name: '사업자2', status: 'active', features: {}, version: 1 }];
  db.property = [{ id: 'p1', name: '지점1', organizationId: 'o1', featureOverrides: {}, featureVersion: 1 }, { id: 'p2', name: '지점2', organizationId: 'o2', featureOverrides: {}, featureVersion: 1 }, { id: 'p3', name: '미소속지점', organizationId: null, featureOverrides: {}, featureVersion: 1 }];
  db.user = [{ id: 'admin-1', email: 'super@test', role: 'super_admin', status: 'active', organizationId: null, enabledModules: null, accessVersion: 1, password: 'secret' }, { id: 'business-admin-1', displayName: '사업자관리자1', email: 'business@example.com', role: 'admin', status: 'active', organizationId: 'o1', enabledModules: null, accessVersion: 1 }, { id: 'manager-1', displayName: '매니저1', email: 'manager@example.com', role: 'manager', status: 'active', organizationId: 'o1', enabledModules: null, accessVersion: 1, password: 'secret' }, { id: 'manager-2', email: 'other@example.com', role: 'manager', status: 'active', organizationId: 'o2', enabledModules: null, accessVersion: 1 }];
  db.userProperty = [{ userId: 'manager-1', propertyId: 'p1' }, { userId: 'manager-2', propertyId: 'p2' }];
});

test('설정 목록은 사업자 관리자에게 같은 사업자만 반환하고 비밀번호를 노출하지 않는다', async () => {
  actAsBusinessAdmin('o1', ['p1']); const result = await invoke(SETTINGS, 'operations-settings');
  assert.equal(result.status, 200); assert.deepEqual(result.body.organizations.map((item: any) => item.id), ['o1']); assert.deepEqual(result.body.properties.map((item: any) => item.id), ['p1']); assert.deepEqual(result.body.users.map((item: any) => item.id).sort(), ['business-admin-1', 'manager-1']);
  assert.equal(result.body.users[0].password, undefined); assert.equal(result.body.properties[0].version, 1); assert.equal(result.body.viewer.role, 'admin');
});
test('매니저·청소인력·비로그인 사용자는 설정 및 활동 목록에 접근할 수 없다', async () => {
  for (const actor of [() => actAsManager(['p1']), () => actAsCleaner(['p1']), actAsAnonymous]) { actor(); const expected = actor === actAsAnonymous ? 401 : 403; assert.equal((await invoke(SETTINGS, 'operations-settings')).status, expected); assert.equal((await invoke(ACTIVITY, 'activity')).status, expected); }
});
test('슈퍼매니저의 사업자 생성은 미소속 지점을 묶고 변경 로그를 같은 트랜잭션으로 기록한다', async () => {
  const result = await invoke(ORGANIZATION, 'organizations', { name: '새로운 사업자', propertyIds: ['p3'], features: { laundry: true, priceLabs: false } });
  assert.equal(result.status, 201); const id = result.body.organization.id; assert.equal(db.property.find(row => row.id === 'p3')!.organizationId, id); assert.equal(db.property.find(row => row.id === 'p3')!.featureVersion, 2); assert.equal(db.auditLog.length, 1); assert.equal(db.auditLog[0].organizationId, id); assert.equal(db.auditLog[0].action, 'organization.create');
});
test('사업자 관리자에게 사업자 생성 및 사용 옵션 변경은 허용되지 않는다', async () => {
  actAsBusinessAdmin('o1', ['p1']); assert.equal((await invoke(ORGANIZATION, 'organizations', { name: '새사업자' })).status, 403);
  assert.equal((await invoke(SAVE, 'operations-settings', { organizations: [{ id: 'o1', version: 1, features: { priceLabs: true } }] }, undefined, 'PUT')).status, 403);
  assert.equal(db.organization[0].features.priceLabs, false);
});
test('사업자 관리자는 자기 지점 옵션만 변경하고 사업자에서 꺼진 옵션을 켤 수 없다', async () => {
  actAsBusinessAdmin('o1', ['p1']);
  assert.equal((await invoke(SAVE, 'operations-settings', { properties: [{ id: 'p2', version: 1, featureOverrides: { laundry: false } }] }, undefined, 'PUT')).status, 403);
  assert.equal((await invoke(SAVE, 'operations-settings', { properties: [{ id: 'p1', version: 1, featureOverrides: { priceLabs: true } }] }, undefined, 'PUT')).status, 403);
  assert.equal((await invoke(SAVE, 'operations-settings', { properties: [{ id: 'p1', version: 1, featureOverrides: { laundry: false } }] }, undefined, 'PUT')).status, 200); assert.deepEqual(db.property[0].featureOverrides, { laundry: false }); assert.equal(db.property[0].featureVersion, 2);
});
test('오래된 버전 또는 알 수 없는 옵션은 저장되지 않는다', async () => {
  for (const body of [{ organizations: [{ id: 'o1', version: 2, features: {} }] }, { properties: [{ id: 'p1', version: 2, featureOverrides: {} }] }]) assert.equal((await invoke(SAVE, 'operations-settings', body, undefined, 'PUT')).status, 409);
  for (const body of [{ organizations: [{ id: 'o1', version: 1, features: { unknown: true } }] }, { properties: [{ id: 'p1', version: 1, featureOverrides: { cleaning: 'on' } }] }, { properties: [{ id: 'p1', version: 1, password: 'secret' }] }]) assert.equal((await invoke(SAVE, 'operations-settings', body, undefined, 'PUT')).status, 400);
  assert.equal(db.organization[0].version, 1); assert.equal(db.property[0].featureVersion, 1); assert.equal((db.auditLog ?? []).length, 0);
});
test('복수 변경 중 마지막 항목이 잘못됐으면 앞 항목도 저장하지 않는다', async () => {
  const result = await invoke(SAVE, 'operations-settings', { organizations: [{ id: 'o1', version: 1, features: { cleaning: false } }], properties: [{ id: 'missing', version: 1, featureOverrides: {} }] }, undefined, 'PUT');
  assert.equal(result.status, 404); assert.deepEqual(db.organization[0].features, { priceLabs: false }); assert.equal(db.organization[0].version, 1);
});
test('변경 로그를 저장할 수 없으면 실제 설정 변경도 롤백한다', async () => {
  prismaOverrides.auditLog = { create: async () => { throw new Error('audit unavailable'); } };
  assert.equal((await invoke(SAVE, 'operations-settings', { organizations: [{ id: 'o1', version: 1, features: { cleaning: false } }] }, undefined, 'PUT')).status, 500); assert.deepEqual(db.organization[0].features, { priceLabs: false }); assert.equal(db.organization[0].version, 1);
});
test('다른 사업자 직원이 배정된 지점은 이동하거나 소속을 해제할 수 없다', async () => {
  assert.equal((await invoke(SAVE, 'operations-settings', { properties: [{ id: 'p1', version: 1, organizationId: 'o2' }] }, undefined, 'PUT')).status, 409);
  assert.equal((await invoke(ORGANIZATION_PATCH, 'organizations/o1', { version: 1, propertyIds: [] }, 'o1', 'PATCH')).status, 409); assert.equal(db.property[0].organizationId, 'o1');
});
test('사업자 관리자는 자기 매니저의 메뉴 및 지점 배정만 수정한다', async () => {
  actAsBusinessAdmin('o1', ['p1']); const result = await invoke(USER_ACCESS, 'user-access/manager-1', { version: 1, enabledModules: ['cleaning', 'inventory'], propertyIds: ['p1'] }, 'manager-1', 'PATCH');
  assert.equal(result.status, 200); assert.deepEqual(result.body.user.enabledModules, ['cleaning', 'inventory']); assert.equal(result.body.user.version, 2); assert.equal(result.body.user.password, undefined); assert.equal(db.auditLog[0].action, 'user.access.update');
  assert.equal((await invoke(USER_ACCESS, 'user-access/manager-2', { version: 1, status: 'suspended' }, 'manager-2', 'PATCH')).status, 403);
});
test('사업자 관리자는 관리자 승격·사업자 이동·다른 사업자 지점 배정 권한이 없다', async () => {
  actAsBusinessAdmin('o1', ['p1']);
  for (const body of [{ version: 1, role: 'admin' }, { version: 1, role: 'super_admin' }, { version: 1, organizationId: 'o2' }]) assert.equal((await invoke(USER_ACCESS, 'user-access/manager-1', body, 'manager-1', 'PATCH')).status, 403);
  assert.equal((await invoke(USER_ACCESS, 'user-access/manager-1', { version: 1, propertyIds: ['p2'] }, 'manager-1', 'PATCH')).status, 400); assert.equal(db.user[2].role, 'manager');
});
test('자기 계정의 슈퍼 권한·활성 상태를 해제할 수 없고 청소 인력에는 고객 메시지를 배정할 수 없다', async () => {
  for (const body of [{ version: 1, role: 'manager' }, { version: 1, status: 'suspended' }]) assert.equal((await invoke(USER_ACCESS, 'user-access/admin-1', body, 'admin-1', 'PATCH')).status, 400);
  assert.equal((await invoke(USER_ACCESS, 'user-access/manager-1', { version: 1, role: 'cleaner', enabledModules: ['messages'] }, 'manager-1', 'PATCH')).status, 400);
});
test('명시적 빈 메뉴 목록은 기본 권한으로 되돌아가지 않는다', async () => {
  assert.equal((await invoke(USER_ACCESS, 'user-access/manager-1', { version: 1, enabledModules: [] }, 'manager-1', 'PATCH')).status, 200); assert.deepEqual(db.user[2].enabledModules, []);
  assert.equal((await invoke(USER_ACCESS, 'user-access/manager-1', { version: 2, enabledModules: null }, 'manager-1', 'PATCH')).status, 200); assert.equal(db.user[2].enabledModules, null);
});
test('로그인 없는 직원은 설정에서 활성 상태만 켜서 로그인 계정으로 만들 수 없다', async () => { db.user[2].status = 'no_account'; assert.equal((await invoke(USER_ACCESS, 'user-access/manager-1', { version: 1, status: 'active' }, 'manager-1', 'PATCH')).status, 400); assert.equal(db.user[2].status, 'no_account'); });
test('사업자 관리자 초대는 실제 이메일을 보내지 않고 일회성 링크만 생성한다', async () => {
  const result = await invoke(INVITE, 'organizations/o1/invite', { email: 'new-admin@example.com' }, 'o1');
  assert.equal(result.status, 201); assert.match(result.body.invitationUrl, /\/invite\/[a-zA-Z0-9_-]{40,}/); assert.equal(db.invitation[0].role, 'admin'); assert.equal(db.invitation[0].organizationId, 'o1');
  assert.equal(result.body.invitation.token, undefined); assert.equal(JSON.stringify(db.auditLog).includes(db.invitation[0].token), false);
  assert.equal((await invoke(INVITE, 'organizations/o1/invite', { email: 'new-admin@example.com' }, 'o1')).status, 409);
});
test('지점 추가 요청은 사업자 범위 내에서만 등록·조회되며 슈퍼 승인 시 숙소와 로그를 함께 생성한다', async () => {
  actAsBusinessAdmin('o1', ['p1']); const result = await invoke(REQUEST, 'property-requests', { name: '새로운 한옥', note: '예정 지점' }); assert.equal(result.status, 201);
  assert.equal((await invoke(REQUEST, 'property-requests', { name: '다른사업자 지점', organizationId: 'o2' })).status, 403);
  db.propertyRequest.push({ id: 'other', organizationId: 'o2', name: '숨긴 지점', status: 'requested', version: 1, createdAt: new Date() });
  assert.equal((await invoke(REQUESTS, 'property-requests')).body.items.length, 1);
  assert.equal((await invoke(DECIDE, `property-requests/${result.body.request.id}`, { version: 1, status: 'approved' }, result.body.request.id, 'PATCH')).status, 403);
  actAsAdmin(); const approved = await invoke(DECIDE, `property-requests/${result.body.request.id}`, { version: 1, status: 'approved' }, result.body.request.id, 'PATCH'); assert.equal(approved.status, 200);
  const property = db.property.find(row => row.id === approved.body.request.propertyId)!; assert.equal(property.organizationId, 'o1'); assert.equal(property.ownerId, 'business-admin-1'); assert.equal(db.auditLog.at(-1)!.action, 'property.request.approved');
  assert.equal((await invoke(DECIDE, `property-requests/${result.body.request.id}`, { version: 1, status: 'approved' }, result.body.request.id, 'PATCH')).status, 409);
});
test('반려는 기존 지점을 만들지 않고 결정 이력을 유지한다', async () => {
  db.propertyRequest = [{ id: 'r1', organizationId: 'o1', name: '신규', status: 'requested', version: 1, requestedBy: 'business-admin-1' }]; const result = await invoke(DECIDE, 'property-requests/r1', { version: 1, status: 'rejected', decisionNote: '위치 재확인' }, 'r1', 'PATCH'); assert.equal(result.status, 200); assert.equal(db.property.length, 3); assert.equal(db.propertyRequest[0].decisionNote, '위치 재확인'); assert.equal(db.propertyRequest[0].version, 2);
});
test('슈퍼매니저가 사업자를 지정해 등록한 요청도 정상 승인할 수 있다', async () => {
  const result = await invoke(REQUEST, 'property-requests', { organizationId: 'o1', name: '운영자 신규지점' }); assert.equal(result.status, 201);
  const approved = await invoke(DECIDE, `property-requests/${result.body.request.id}`, { version: 1, status: 'approved' }, result.body.request.id, 'PATCH'); assert.equal(approved.status, 200); assert.equal(db.property.find(row => row.id === approved.body.request.propertyId)!.organizationId, 'o1');
});
test('활동 조회는 사업자 범위를 지키며 동일 시각 항목도 커서로 빠짐없이 조회한다', async () => {
  const date = new Date('2026-10-04T01:00:00Z'); db.auditLog = ['3', '2', '1'].map(id => ({ id, organizationId: 'o1', actorName: '운영자', summary: '설정 변경', module: 'properties', outcome: 'success', createdAt: date })); db.auditLog.push({ id: '4', organizationId: 'o2', summary: '비공개', createdAt: date });
  actAsBusinessAdmin('o1', ['p1']); const first = await invoke(ACTIVITY, 'activity?pageSize=2'); assert.equal(first.status, 200); assert.deepEqual(first.body.items.map((item: any) => item.id), ['3', '2']); assert.equal(first.body.hasMore, true);
  const second = await invoke(ACTIVITY, `activity?pageSize=2&cursor=${first.body.nextCursor}`); assert.deepEqual(second.body.items.map((item: any) => item.id), ['1']); assert.equal(second.body.nextCursor, null);
  for (const path of ['activity?organizationId=o2', 'activity?propertyId=p2']) assert.equal((await invoke(ACTIVITY, path)).status, 403);
});
test('활동 조회 건수·커서·날짜 입력을 제한하고 필터를 적용한다', async () => {
  for (const path of ['activity?pageSize=1000', 'activity?cursor=invalid', 'activity?from=no-date', 'activity?from=2026-10-05&to=2026-10-01', 'activity?module=unknown', 'activity?outcome=unknown']) assert.equal((await invoke(ACTIVITY, path)).status, 400);
  db.auditLog = [{ id: 'a', organizationId: 'o1', module: 'properties', outcome: 'success', summary: '기능 변경', createdAt: new Date('2026-10-03T16:00:00Z') }, { id: 'b', organizationId: 'o1', module: 'staff', outcome: 'denied', summary: '권한 변경', createdAt: new Date('2026-10-03T14:00:00Z') }];
  const filtered = await invoke(ACTIVITY, 'activity?from=2026-10-04&to=2026-10-04&module=properties&outcome=success'); assert.deepEqual(filtered.body.items.map((item: any) => item.id), ['a']);
});
test('필수 테이블이 없을 때 마이그레이션 필요 응답을 반환한다', async () => {
  prismaOverrides.organization = { findMany: async () => { throw Object.assign(new Error('missing'), { code: 'P2021' }); } }; const result = await invoke(SETTINGS, 'operations-settings'); assert.equal(result.status, 503); assert.equal(result.body.migrationRequired, true); assert.equal(calls.includes('auditLog.create'), false);
});
