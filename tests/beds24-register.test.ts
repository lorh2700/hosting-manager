import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb, calls } from './stubs/prisma';
import { actAsAdmin } from './stubs/auth';
import { installBeds24Mock, json, resetFetch, sampleBooking, postsTo, makeRequest, callRoute, fetchLog } from './helpers/beds24-mock';
import { invalidateBeds24Token } from '@/lib/beds24';
import { POST as RESERVATION_POST, DELETE as RESERVATION_DELETE } from '@/app/api/beds24/reservations/route';
import { POST as MAINTENANCE_POST, DELETE as MAINTENANCE_DELETE } from '@/app/api/beds24/maintenance/route';

const baseBody = { propertyId: 'p1', startDate: '2026-10-01', endDate: '2026-10-03', name: '홍길동', numAdult: 2, numChild: 0, tags: ['픽업 요청'] };
const upsertIndex = () => calls.indexOf('event.upsert');
const verifyIndex = () => calls.findIndex(c => c.startsWith('GET /bookings?id=123'));

beforeEach(() => {
  resetDb(); resetFetch(); invalidateBeds24Token(); actAsAdmin();
  db.property = [{ id: 'p1', beds24PropId: '111', beds24RoomId: '555' }];
});

test('예약 등록: Beds24 생성 → GET 확인 → 그 뒤에만 플랫폼 upsert', async () => {
  installBeds24Mock();
  const res = await callRoute(RESERVATION_POST, makeRequest(baseBody));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.origin, 'created');
  assert.equal(postsTo('/bookings')[0].body[0].status, 'confirmed');
  assert.ok(verifyIndex() >= 0 && upsertIndex() > verifyIndex(), calls.join(' > '));
  const saved = db.event[0];
  assert.equal(saved.originalUid, '123');
  assert.equal(saved.source, 'manual-reservation');
  assert.deepEqual(saved.tags, ['픽업 요청']);
});

test('POST 응답 유실 → 조회로 복구, 중복 POST 없음', async () => {
  let searchCalls = 0;
  installBeds24Mock({
    onCreate: () => { throw new TypeError('fetch failed'); },
    onSearch: () => json({ data: ++searchCalls === 1 ? [] : [sampleBooking()] }),
  });
  const res = await callRoute(RESERVATION_POST, makeRequest(baseBody));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.origin, 'recovered');
  assert.equal(postsTo('/bookings').length, 1);
});

test('최종 확인 통신 실패 → 502 + pendingBeds24BookingId, 저장 없음', async () => {
  installBeds24Mock({ onGetById: () => json({ error: 'boom' }, 500) });
  const res = await callRoute(RESERVATION_POST, makeRequest(baseBody));
  assert.equal(res.status, 502, JSON.stringify(res.body));
  assert.equal(res.body.pendingBeds24BookingId, '123');
  assert.ok(!calls.includes('event.upsert'));
});

test('pending id 재시도 → POST 없이 확인 후 저장', async () => {
  installBeds24Mock();
  const res = await callRoute(RESERVATION_POST, makeRequest({ ...baseBody, beds24BookingId: '123' }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.origin, 'provided');
  assert.equal(postsTo('/bookings').length, 0);
});

test('Beds24 가 거부(success:false) → 422, 저장 없음', async () => {
  installBeds24Mock({ onCreate: () => json([{ success: false, errors: [{ field: 'arrival', message: 'Invalid date' }] }]) });
  const res = await callRoute(RESERVATION_POST, makeRequest(baseBody));
  assert.equal(res.status, 422);
  assert.match(res.body.error, /Invalid date/);
  assert.ok(!calls.includes('event.upsert'));
});

test('예약 취소: Beds24 취소 후 로컬 삭제, 자동 청소 정리까지', async () => {
  installBeds24Mock();
  db.event = [{ id: 'evt-1', propertyId: 'p1', channelId: 'beds24', type: 'reservation', originalUid: '123', source: 'manual-reservation', startDate: '2026-10-01', endDate: '2026-10-03' }];
  const res = await callRoute(RESERVATION_DELETE, makeRequest({}, 'http://localhost/api/beds24/reservations?eventId=evt-1'));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(fetchLog.some(l => l.method === 'PUT' && l.body?.[0]?.status === 'cancelled'));
  assert.equal(db.event.length, 0);
  assert.ok(calls.indexOf('cleaning.findMany') > calls.indexOf('event.delete'), '삭제 후 청소 정리');
});

test('객실정비: black 으로 생성, 확인은 black 만 통과, 로컬은 block/maintenance', async () => {
  installBeds24Mock({
    onCreate: (body) => json([{ success: true, new: sampleBooking({ status: body[0].status, firstName: body[0].firstName }) }]),
    onGetById: () => json({ data: [sampleBooking({ status: 'black', firstName: '객실정비' })] }),
  });
  const res = await callRoute(MAINTENANCE_POST, makeRequest({ propertyId: 'p1', startDate: '2026-10-01', endDate: '2026-10-03', reason: '보일러 점검' }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const created = postsTo('/bookings')[0].body[0];
  assert.equal(created.status, 'black');
  assert.equal(created.notes, '객실정비: 보일러 점검');
  assert.equal(db.event[0].type, 'block');
  assert.equal(db.event[0].source, 'maintenance');
  assert.deepEqual(db.event[0].tags, ['maintenance']);
});

test('객실정비: Beds24 가 차단이 아닌 예약으로 돌려주면 409, 저장 없음', async () => {
  installBeds24Mock({
    onCreate: () => json([{ success: true, new: sampleBooking({ status: 'black' }) }]),
    onGetById: () => json({ data: [sampleBooking({ status: 'confirmed' })] }),
  });
  const res = await callRoute(MAINTENANCE_POST, makeRequest({ propertyId: 'p1', startDate: '2026-10-01', endDate: '2026-10-03' }));
  assert.equal(res.status, 409);
  assert.ok(!calls.includes('event.upsert'));
});

test('객실정비 해제: Beds24 취소 후 로컬 삭제, 예약 이벤트는 거부', async () => {
  installBeds24Mock();
  db.event = [
    { id: 'evt-m', propertyId: 'p1', channelId: 'beds24', type: 'block', originalUid: '123', source: 'maintenance' },
    { id: 'evt-r', propertyId: 'p1', channelId: 'beds24', type: 'reservation', originalUid: '124', source: 'booking' },
  ];
  const ok = await callRoute(MAINTENANCE_DELETE, makeRequest({}, 'http://localhost/api/beds24/maintenance?eventId=evt-m'));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(!db.event.some(e => e.id === 'evt-m'));
  const bad = await callRoute(MAINTENANCE_DELETE, makeRequest({}, 'http://localhost/api/beds24/maintenance?eventId=evt-r'));
  assert.equal(bad.status, 400);
});
