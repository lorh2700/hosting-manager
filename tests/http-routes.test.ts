import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsHost, actAsCleaner, actAsAnonymous } from './stubs/auth';
import { makeRequest, callRoute } from './helpers/beds24-mock';
import { GET as EVENTS_GET, PUT as EVENTS_PUT, DELETE as EVENTS_DELETE } from '@/app/api/events/route';
import { PUT as BOOKINGS_PUT } from '@/app/api/bookings/route';
import { PUT as USERS_PUT } from '@/app/api/users/route';
import { DELETE as PROPERTY_DELETE } from '@/app/api/properties/[id]/route';

beforeEach(() => {
  resetDb();
  actAsAdmin();
  db.property = [{ id: 'p1', name: 'A', ownerId: 'host-1' }, { id: 'p2', name: 'B', ownerId: 'other' }];
  db.event = [
    { id: 'e1', propertyId: 'p1', type: 'reservation', startDate: '2026-10-01', endDate: '2026-10-03', channelId: 'beds24' },
    { id: 'e2', propertyId: 'p2', type: 'reservation', startDate: '2026-10-05', endDate: '2026-10-07', channelId: 'beds24' },
  ];
});

test('withAuth: 세션이 없으면 401', async () => {
  actAsAnonymous();
  const res = await callRoute(EVENTS_GET, makeRequest({}, 'http://localhost/api/events'));
  assert.equal(res.status, 401);
});

test('읽기 범위: 청소매니저는 자기 호스트의 숙소만 본다', async () => {
  actAsCleaner(['p1']);
  const res = await callRoute(EVENTS_GET, makeRequest({}, 'http://localhost/api/events?propertyIds=p1,p2'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((e: { id: string }) => e.id), ['e1']);
});

test('쓰기 권한: 청소매니저는 이벤트를 수정할 수 없다 (403)', async () => {
  actAsCleaner(['p1']);
  const res = await callRoute(EVENTS_PUT, makeRequest({ id: 'e1', title: 'x' }));
  assert.equal(res.status, 403);
  assert.equal(db.event[0].title, undefined);
});

test('쓰기 권한: 호스트는 담당 숙소만 수정·삭제할 수 있다', async () => {
  actAsHost(['p1']);
  const okRes = await callRoute(EVENTS_PUT, makeRequest({ id: 'e1', title: '변경' }));
  assert.equal(okRes.status, 200);
  assert.equal(db.event[0].title, '변경');

  const denied = await callRoute(EVENTS_DELETE, makeRequest({}, 'http://localhost/api/events?id=e2'));
  assert.equal(denied.status, 403);
  assert.equal(db.event.length, 2);
});

test('입력 검증: 잘못된 JSON 은 400, 알 수 없는 필드는 무시된다', async () => {
  const bad = { json: async () => { throw new SyntaxError('bad'); }, url: 'http://localhost/api/events', headers: new Headers() } as unknown as Request;
  const res = await callRoute(EVENTS_PUT, bad);
  assert.equal(res.status, 400);

  db.booking = [{ id: 'b1', propertyId: 'p1', checkIn: '2026-10-01', checkOut: '2026-10-03', status: 'confirmed' }];
  const res2 = await callRoute(BOOKINGS_PUT, makeRequest({ id: 'b1', status: 'cancelled', cancelledAt: 'now', origin: 'hack' }));
  assert.equal(res2.status, 200, JSON.stringify(res2.body));
  assert.equal(db.booking[0].status, 'cancelled');
  assert.equal(db.booking[0].cancelledAt, undefined);
  assert.equal(db.booking[0].origin, undefined);
});

test('사용자 수정: 본인은 역할·상태를 바꿀 수 없고 관리자만 바꾼다', async () => {
  actAsHost(['p1']);
  db.user = [{ id: 'host-1', email: 'host@test', role: 'host', status: 'active', displayName: 'H' }];
  const self = await callRoute(USERS_PUT, makeRequest({ id: 'host-1', displayName: '새이름', role: 'super_admin', status: 'suspended' }));
  assert.equal(self.status, 200, JSON.stringify(self.body));
  assert.equal(db.user[0].displayName, '새이름');
  assert.equal(db.user[0].role, 'host');
  assert.equal(db.user[0].status, 'active');

  const other = await callRoute(USERS_PUT, makeRequest({ id: 'someone-else', displayName: 'x' }));
  assert.equal(other.status, 403);
});

test('숙소 삭제: 관리자가 아니면 소유자만', async () => {
  actAsHost(['p1']);
  const res = await callRoute(
    (req) => PROPERTY_DELETE(req, { params: Promise.resolve({ id: 'p2' }) }),
    makeRequest({}, 'http://localhost/api/properties/p2'),
  );
  assert.equal(res.status, 403);
  assert.equal(db.property.length, 2);
});
