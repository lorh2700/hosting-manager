/**
 * 패드 셀프 체크아웃 — 신호 기록·중복 방지·알림 대상.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb } from './stubs/prisma';
import { notifyCalls, resetNotify } from './stubs/notify';
import { callRoute } from './helpers/beds24-mock';
import { GET, POST } from '@/app/api/public/welcomepad/checkout/route';
import { todayKst } from '../lib/dates';

process.env.WELCOMEPAD_API_KEY = 'pad-key';
const URL_BASE = 'http://localhost/api/public/welcomepad/checkout';

const request = (method: 'GET' | 'POST', opts: { body?: unknown; query?: string; key?: string } = {}) =>
  new Request(`${URL_BASE}${opts.query ?? ''}`, {
    method,
    headers: { 'x-api-key': opts.key ?? 'pad-key', 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

beforeEach(() => {
  resetDb();
  resetNotify();
  db.user = [{ id: 'host-1', email: 'host@test', role: 'admin', phone: '01011112222', displayName: '도영' }];
  db.property = [{ id: 'p1', name: '안온재', ownerId: 'host-1', welcomepadKey: 'anon' }];
  db.cleaner = [
    { id: 'cl-1', name: '민들레', phone: '01033334444', ownerId: 'host-1', notifyNewOpen: true },
    { id: 'cl-2', name: '윤나', phone: '01055556666', ownerId: 'host-1', notifyNewOpen: true },
    { id: 'cl-3', name: '조용', phone: '01077778888', ownerId: 'host-1', notifyNewOpen: false },
  ];
  db.cleanerProperty = [{ cleanerId: 'cl-2', propertyId: 'p-other' }];
  db.event = [{ id: 'ev-1', propertyId: 'p1', type: 'reservation', originalUid: 'B123', startDate: '2026-09-01', endDate: todayKst() }];
});

test('비밀키가 없거나 틀리면 401', async () => {
  const res = await callRoute(POST, request('POST', { body: { propertyKey: 'anon' }, key: 'wrong' }));
  assert.equal(res.status, 401);
  assert.equal((db.checkoutSignal ?? []).length, 0);
});

test('셀프 체크아웃: 신호 기록 + 배정 담당자와 호스트에게 알림, 예약 연결', async () => {
  db.cleaning = [{ id: 'c1', propertyId: 'p1', date: todayKst(), cleanerId: 'cl-1', status: 'pending' }];
  const res = await callRoute(POST, request('POST', { body: { propertyKey: 'anon', bookingId: 'B123' } }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.duplicate, false);
  assert.equal(res.body.notified, 2);

  assert.equal(db.checkoutSignal.length, 1);
  assert.equal(db.checkoutSignal[0].kind, 'guest_pad');
  assert.equal(db.checkoutSignal[0].eventId, 'ev-1');

  const phones = notifyCalls.checkout.map(c => c.phone).sort();
  assert.deepEqual(phones, ['01011112222', '01033334444']);
  assert.ok(notifyCalls.checkout.every(c => c.by === 'guest' && c.propertyName === '안온재'));
});

test('같은 날 두 번 누르면 중복으로 처리하고 알림을 다시 보내지 않는다', async () => {
  db.cleaning = [{ id: 'c1', propertyId: 'p1', date: todayKst(), cleanerId: 'cl-1', status: 'pending' }];
  await callRoute(POST, request('POST', { body: { propertyKey: 'anon' } }));
  const again = await callRoute(POST, request('POST', { body: { propertyKey: 'anon' } }));
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(db.checkoutSignal.length, 1);
  assert.equal(notifyCalls.checkout.length, 2, '첫 호출의 2건뿐');
});

test('미배정이면 그 숙소를 보는 알림 켠 담당자 전원 + 호스트', async () => {
  db.cleaning = [{ id: 'c1', propertyId: 'p1', date: todayKst(), cleanerId: null, status: 'pending' }];
  const res = await callRoute(POST, request('POST', { body: { propertyKey: 'anon' } }));
  assert.equal(res.status, 201);
  // cl-1: 배정 없음 → 대상. cl-2: 다른 지점만 배정 → 제외. cl-3: 알림 끔 → 제외. + 호스트
  assert.deepEqual(notifyCalls.checkout.map(c => c.phone).sort(), ['01011112222', '01033334444']);
});

test('상태 조회: 확인 여부·시각·주체', async () => {
  const before = await callRoute(GET, request('GET', { query: '?propertyKey=anon' }));
  assert.equal(before.status, 200);
  assert.equal(before.body.confirmed, false);

  await callRoute(POST, request('POST', { body: { propertyKey: 'anon' } }));
  const after = await callRoute(GET, request('GET', { query: '?propertyKey=anon' }));
  assert.equal(after.body.confirmed, true);
  assert.equal(after.body.confirmedBy, 'guest_pad');
  assert.ok(after.body.confirmedAt);
  assert.equal(after.body.signals.length, 1);

  const missing = await callRoute(GET, request('GET', { query: '?propertyKey=nope' }));
  assert.equal(missing.status, 404);
});
