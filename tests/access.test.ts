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

test('읽기 범위: 관리자 전체, 매니저 배정 숙소, 청소담당자 명시적 숙소 배정', async () => {
  assert.equal(await getVisiblePropertyIds(authState.auth), null);
  assert.deepEqual(await getVisiblePropertyIds(authState.auth, ['p1', 'p3']), ['p1', 'p3']);

  actAsManager(['p2']);
  assert.deepEqual(await getVisiblePropertyIds(authState.auth), ['p2']);
  assert.deepEqual(await getVisiblePropertyIds(authState.auth, ['p1', 'p2']), ['p2']);
  actAsManager([]);
  assert.deepEqual(await getVisiblePropertyIds(authState.auth), []);

  actAsCleaner(['p1', 'p2']); // 모든 배정은 user_properties에 명시
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

test('/api/properties: 청소담당자는 배정 숙소만, 계정 없으면 빈 목록, 숙소 생성은 403', async () => {
  actAsCleaner(['p1', 'p2']);
  const res = await callRoute(PROPERTIES_GET, makeRequest({}, 'http://localhost/api/properties'));
  assert.deepEqual(res.body.map((p: { id: string }) => p.id).sort(), ['p1', 'p2']);

  actAsCleaner([], { withProfile: false });
  const none = await callRoute(PROPERTIES_GET, makeRequest({}, 'http://localhost/api/properties'));
  assert.deepEqual(none.body, []);

  const denied = await callRoute(PROPERTIES_POST, makeRequest({ name: '새집' }));
  assert.equal(denied.status, 403);
});

test('/api/cleanings?isOpen=true: 청소 신청 범위 = 배정 지점 (UserProperty 공통 범위)', async () => {
  db.cleaning = [
    { id: 'c1', propertyId: 'p1', date: '2026-10-01', status: 'pending', cleanerId: null },
    { id: 'c2', propertyId: 'p2', date: '2026-10-02', status: 'pending', cleanerId: null },
    { id: 'c3', propertyId: 'p3', date: '2026-10-03', status: 'pending', cleanerId: null },
  ];
  actAsCleaner(['p2']);
  const res = await callRoute(CLEANINGS_GET, makeRequest({}, 'http://localhost/api/cleanings?isOpen=true'));
  assert.deepEqual(res.body.map((c: { id: string }) => c.id), ['c2']);

  actAsCleaner(['p1', 'p2']);
  const all = await callRoute(CLEANINGS_GET, makeRequest({}, 'http://localhost/api/cleanings?isOpen=true'));
  assert.deepEqual(all.body.map((c: { id: string }) => c.id).sort(), ['c1', 'c2']);
});
