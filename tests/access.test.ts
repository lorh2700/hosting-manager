/**
 * 권한 표 테스트 — 역할 3종(admin/manager/cleaner)과 "배정 지점 한 규칙".
 * lib/access 의 실제 로직이 인메모리 prisma 위에서 돈다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/solapi-env';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsManager, actAsCleaner, authState } from './stubs/auth';
import { makeRequest, callRoute, setFetchHandler, fetchLog, resetFetch, json } from './helpers/beds24-mock';
import { normalizeRole, getVisiblePropertyIds, canManageProperty, cleanerPropertyIds } from '../lib/access';
import { GET as PROPERTIES_GET, POST as PROPERTIES_POST } from '@/app/api/properties/route';
import { GET as CLEANINGS_GET } from '@/app/api/cleanings/route';
import { GET as USERS_GET, PUT as USERS_PUT } from '@/app/api/users/route';
import { DELETE as USER_DELETE } from '@/app/api/users/[id]/route';
import { PUT as ASSIGN_PUT } from '@/app/api/cleaners/[id]/properties/route';
import { PUT as CLEANERS_PUT, DELETE as CLEANERS_DELETE } from '@/app/api/cleaners/route';
import { notifyNewOpenCleanings } from '../lib/notify';

setFetchHandler(() => json({ messageId: 'ok' }));

beforeEach(() => {
  resetDb();
  resetFetch();
  actAsAdmin();
  // host-1 이 p1, p2 를 소유하고 other 가 p3 을 소유한다.
  db.property = [
    { id: 'p1', name: '안온재', ownerId: 'host-1' },
    { id: 'p2', name: '운와당', ownerId: 'host-1' },
    { id: 'p3', name: '남의집', ownerId: 'other' },
  ];
});

test('normalizeRole: 옛 값은 3종으로 흡수된다', () => {
  assert.equal(normalizeRole('super_admin'), 'admin');
  assert.equal(normalizeRole('admin'), 'admin');
  assert.equal(normalizeRole('manager'), 'manager');
  assert.equal(normalizeRole('host'), 'manager');
  assert.equal(normalizeRole('viewer'), 'manager');
  assert.equal(normalizeRole('cleaner'), 'cleaner');
  assert.equal(normalizeRole(undefined), 'manager');
  assert.equal(normalizeRole('garbage'), 'manager');
});

test('읽기 범위: 관리자 전체, 매니저 배정 숙소, 청소담당자 배정 지점(없으면 호스트 숙소 전부)', async () => {
  assert.equal(await getVisiblePropertyIds(authState.auth), null);
  assert.deepEqual(await getVisiblePropertyIds(authState.auth, ['p1', 'p3']), ['p1', 'p3']);

  actAsManager(['p2']);
  assert.deepEqual(await getVisiblePropertyIds(authState.auth), ['p2']);
  assert.deepEqual(await getVisiblePropertyIds(authState.auth, ['p1', 'p2']), ['p2']);
  actAsManager([]);
  assert.deepEqual(await getVisiblePropertyIds(authState.auth), []);

  actAsCleaner([]); // 배정 없음 → host-1 의 숙소 전부, 남의 숙소는 아님
  assert.deepEqual((await getVisiblePropertyIds(authState.auth))!.sort(), ['p1', 'p2']);
  actAsCleaner(['p1']);
  assert.deepEqual(await getVisiblePropertyIds(authState.auth), ['p1']);
  assert.deepEqual(await getVisiblePropertyIds(authState.auth, ['p2']), []);

  actAsCleaner([], { withProfile: false }); // 프로필 없는 청소 계정은 아무것도 못 본다 (예전 "전체 반환" 폴백 제거)
  assert.deepEqual(await getVisiblePropertyIds(authState.auth), []);
});

test('쓰기 권한: 청소담당자는 배정 지점이 있어도 수정 불가, 매니저는 배정 숙소만', () => {
  actAsAdmin();
  assert.equal(canManageProperty(authState.auth, 'p3'), true);
  actAsManager(['p1']);
  assert.equal(canManageProperty(authState.auth, 'p1'), true);
  assert.equal(canManageProperty(authState.auth, 'p2'), false);
  actAsCleaner(['p1']);
  assert.equal(canManageProperty(authState.auth, 'p1'), false);
});

test('/api/properties: 청소담당자는 호스트 숙소만, 프로필 없으면 빈 목록, 숙소 생성은 403', async () => {
  actAsCleaner([]);
  const res = await callRoute(PROPERTIES_GET, makeRequest({}, 'http://localhost/api/properties'));
  assert.deepEqual(res.body.map((p: { id: string }) => p.id).sort(), ['p1', 'p2']);

  actAsCleaner([], { withProfile: false });
  const none = await callRoute(PROPERTIES_GET, makeRequest({}, 'http://localhost/api/properties'));
  assert.deepEqual(none.body, []);

  const denied = await callRoute(PROPERTIES_POST, makeRequest({ name: '새집' }));
  assert.equal(denied.status, 403);
});

test('/api/cleanings?isOpen=true: 청소 신청 범위 = 배정 지점 (별도 UserProperty 범위 없음)', async () => {
  db.cleaning = [
    { id: 'c1', propertyId: 'p1', date: '2026-10-01', status: 'pending', cleanerId: null },
    { id: 'c2', propertyId: 'p2', date: '2026-10-02', status: 'pending', cleanerId: null },
    { id: 'c3', propertyId: 'p3', date: '2026-10-03', status: 'pending', cleanerId: null },
  ];
  actAsCleaner(['p2']);
  const res = await callRoute(CLEANINGS_GET, makeRequest({}, 'http://localhost/api/cleanings?isOpen=true'));
  assert.deepEqual(res.body.map((c: { id: string }) => c.id), ['c2']);

  actAsCleaner([]);
  const all = await callRoute(CLEANINGS_GET, makeRequest({}, 'http://localhost/api/cleanings?isOpen=true'));
  assert.deepEqual(all.body.map((c: { id: string }) => c.id).sort(), ['c1', 'c2']);
});

test('지점 배정: 로그인 계정이 없는 담당자도 배정할 수 있고, 만든 호스트만 바꾼다', async () => {
  db.cleaner = [{ id: 'cl-9', name: '민들레', phone: '01011112222', publicToken: 't', userId: null, ownerId: 'host-1', notifyNewOpen: true }];
  actAsManager(['p1']);
  const ok = await callRoute(
    (req) => ASSIGN_PUT(req, { params: Promise.resolve({ id: 'cl-9' }) }),
    makeRequest({ propertyIds: ['p1', 'p1', 'p2'] }),
  );
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(db.cleanerProperty.map(a => a.propertyId).sort(), ['p1', 'p2']);

  const bad = await callRoute(
    (req) => ASSIGN_PUT(req, { params: Promise.resolve({ id: 'cl-9' }) }),
    makeRequest({ propertyIds: ['nope'] }),
  );
  assert.equal(bad.status, 400);

  db.cleaner.push({ id: 'cl-other', name: '남의담당자', phone: null, publicToken: null, userId: null, ownerId: 'other', notifyNewOpen: true });
  const denied = await callRoute(
    (req) => ASSIGN_PUT(req, { params: Promise.resolve({ id: 'cl-other' }) }),
    makeRequest({ propertyIds: [] }),
  );
  assert.equal(denied.status, 403);
});

test('/api/users: 청소담당자 계정은 목록에서 빠지고 여기서 역할을 바꾸거나 지울 수 없다', async () => {
  db.user = [
    { id: 'admin-1', email: 'admin@test', role: 'super_admin', status: 'active', displayName: 'A' },
    { id: 'm-1', email: 'm@test', role: 'host', status: 'active', displayName: 'M' },
    { id: 'cleaner-1', email: '01000000000@phone.local', role: 'cleaner', status: 'active', displayName: 'C' },
  ];
  const list = await callRoute(USERS_GET, makeRequest({}, 'http://localhost/api/users'));
  assert.deepEqual(list.body.map((u: { id: string; role: string }) => [u.id, u.role]), [['admin-1', 'admin'], ['m-1', 'manager']]);

  const toCleaner = await callRoute(USERS_PUT, makeRequest({ id: 'm-1', role: 'cleaner' }));
  assert.equal(toCleaner.status, 400);
  const editCleaner = await callRoute(USERS_PUT, makeRequest({ id: 'cleaner-1', status: 'suspended' }));
  assert.equal(editCleaner.status, 400);
  const del = await callRoute(
    (req) => USER_DELETE(req, { params: Promise.resolve({ id: 'cleaner-1' }) }),
    makeRequest({}, 'http://localhost/api/users/cleaner-1'),
  );
  assert.equal(del.status, 400);
  assert.equal(db.user.length, 3);
});

test('/api/users PUT: 숙소 범위는 매니저에게만 반영되고, 관리자로 바꾸면 무시된다', async () => {
  db.user = [{ id: 'm-1', email: 'm@test', role: 'manager', status: 'pending_invite', displayName: 'M' }];
  const approve = await callRoute(USERS_PUT, makeRequest({ id: 'm-1', status: 'active', role: 'manager', propertyIds: ['p1'] }));
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal(db.user[0].status, 'active');
  assert.deepEqual(db.userProperty.map(u => u.propertyId), ['p1']);

  const promote = await callRoute(USERS_PUT, makeRequest({ id: 'm-1', role: 'admin', propertyIds: ['p1', 'p2'] }));
  assert.equal(promote.status, 200);
  assert.equal(db.user[0].role, 'admin');
  assert.deepEqual(db.userProperty.map(u => u.propertyId), ['p1'], '관리자 승격 시 범위는 건드리지 않는다');
});

test('/api/cleaners PUT: 로그인 켜기/끄기는 연결 계정의 status 만 바꾸고, 알림 플래그를 저장한다', async () => {
  db.cleaner = [{ id: 'cl-1', name: '현정', phone: '01033334444', publicToken: 't', userId: 'u-1', ownerId: 'host-1', notifyNewOpen: true }];
  db.user = [{ id: 'u-1', email: '01033334444@phone.local', role: 'cleaner', status: 'active' }];

  const off = await callRoute(CLEANERS_PUT, makeRequest({ id: 'cl-1', loginEnabled: false }));
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(db.user[0].status, 'suspended');
  assert.equal(off.body.login.status, 'suspended');

  const mute = await callRoute(CLEANERS_PUT, makeRequest({ id: 'cl-1', notifyNewOpen: false }));
  assert.equal(mute.status, 200);
  assert.equal(db.cleaner[0].notifyNewOpen, false);

  db.cleaner.push({ id: 'cl-2', name: '민들레', phone: null, publicToken: 't2', userId: null, ownerId: 'host-1', notifyNewOpen: true });
  const noAccount = await callRoute(CLEANERS_PUT, makeRequest({ id: 'cl-2', loginEnabled: true }));
  assert.equal(noAccount.status, 400);
});

test('/api/cleaners DELETE: 프로필을 지우면 연결된 로그인 계정도 지운다', async () => {
  db.cleaner = [{ id: 'cl-1', name: '현정', phone: '01033334444', publicToken: 't', userId: 'u-1', ownerId: 'host-1', notifyNewOpen: true }];
  db.user = [{ id: 'u-1', email: 'x@phone.local', role: 'cleaner', status: 'active' }];
  const res = await callRoute(CLEANERS_DELETE, makeRequest({}, 'http://localhost/api/cleaners?id=cl-1'));
  assert.equal(res.status, 200);
  assert.equal(db.cleaner.length, 0);
  assert.equal(db.user.length, 0);
});

test('신규 오픈 알림 대상: 알림 켠 담당자 중 이 숙소를 보는 사람만 (배정 없음 = 전부)', async () => {
  db.cleaner = [
    { id: 'a', name: '전체', phone: '01000000001', publicToken: 'ta', ownerId: 'host-1', notifyNewOpen: true },
    { id: 'b', name: 'p2만', phone: '01000000002', publicToken: 'tb', ownerId: 'host-1', notifyNewOpen: true },
    { id: 'c', name: '호스트본인', phone: '01000000003', publicToken: 'tc', ownerId: 'host-1', notifyNewOpen: false },
    { id: 'd', name: '남의담당자', phone: '01000000004', publicToken: 'td', ownerId: 'other', notifyNewOpen: true },
    { id: 'e', name: '링크없음', phone: '01000000005', publicToken: null, ownerId: 'host-1', notifyNewOpen: true },
  ];
  db.cleanerProperty = [{ cleanerId: 'b', propertyId: 'p2' }];

  await notifyNewOpenCleanings({ propertyId: 'p1', dates: ['2026-10-01'] });
  assert.deepEqual(fetchLog.map(l => l.body.message.to).sort(), ['01000000001']);

  resetFetch();
  await notifyNewOpenCleanings({ propertyId: 'p2', dates: ['2026-10-01', '2026-10-02'] });
  assert.deepEqual(fetchLog.map(l => l.body.message.to).sort(), ['01000000001', '01000000001', '01000000002', '01000000002']);
});

test('배정 규칙 헬퍼: cleanerPropertyIds', async () => {
  assert.deepEqual((await cleanerPropertyIds({ id: 'x', ownerId: 'host-1' })).sort(), ['p1', 'p2']);
  db.cleanerProperty = [{ cleanerId: 'x', propertyId: 'p3' }];
  assert.deepEqual(await cleanerPropertyIds({ id: 'x', ownerId: 'host-1' }), ['p3']);
});
