import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb, calls } from './stubs/prisma';
import { notifyCalls, resetNotify } from './stubs/notify';
import { installBeds24Mock, json, resetFetch, sampleBooking, fetchLog } from './helpers/beds24-mock';
import { invalidateBeds24Token } from '@/lib/beds24';
import { ensureCleaningsForProperty, syncBeds24Property } from '@/lib/sync-engine';
import { todayKst, addDaysToDateStr } from '@/lib/dates';

const P = 'prop-1';
const today = todayKst();
const d = (n: number) => addDaysToDateStr(today, n);
const cleanerRow = { id: 'cl1', name: '김청소', phone: '01012341234' };

const cleaning = (over: Record<string, unknown>) => ({
  propertyId: P, origin: 'auto', status: 'pending', cleanerId: null, isOpen: true, ...over,
});
const reservation = (id: string, start: string, end: string) => ({
  id, propertyId: P, channelId: 'beds24', type: 'reservation', originalUid: id, startDate: start, endDate: end, tags: [], source: 'booking',
});
const booking = (id: number, arrival: string, departure: string, over: Record<string, unknown> = {}) =>
  sampleBooking({ id, arrival, departure, firstName: '홍', lastName: '길동', numAdult: 2, numChild: 0, ...over });

function seedBookingsPage(bookings: unknown[]) {
  installBeds24Mock({ onSearch: () => json({ success: true, data: bookings, pages: { nextPageExists: false } }) });
}

beforeEach(() => {
  resetDb(); resetNotify(); resetFetch(); invalidateBeds24Token();
  db.property = [{ id: P, name: '안온재', ownerId: 'host-1' }];
  db.cleaner = [cleanerRow];
});

test('예약이 사라진 자동 생성 청소는 배정돼 있어도 삭제하고 취소 문자를 보낸다; 완료·수동·외부·과거 건은 보존', async () => {
  db.event = [reservation('r1', d(1), d(3))];
  db.cleaning = [
    { id: 'assigned-orphan', ...cleaning({ date: d(5), cleanerId: 'cl1' }) },
    { id: 'unassigned-orphan', ...cleaning({ date: d(9) }) },
    { id: 'done-orphan', ...cleaning({ date: d(6), status: 'done', cleanerId: 'cl1' }) },
    { id: 'manual', ...cleaning({ date: d(7), origin: 'manual' }) },
    { id: 'external', ...cleaning({ date: d(8), origin: 'external' }) },
    { id: 'past-orphan', ...cleaning({ date: d(-2), cleanerId: 'cl1' }) },
  ];

  const created = await ensureCleaningsForProperty(P);

  const ids = db.cleaning.map(c => c.id);
  assert.ok(!ids.includes('assigned-orphan'));
  assert.ok(!ids.includes('unassigned-orphan'));
  for (const keep of ['done-orphan', 'manual', 'external', 'past-orphan']) assert.ok(ids.includes(keep), keep);
  assert.deepEqual(created, [d(3)]);
  assert.ok(db.cleaning.some(c => c.date === d(3) && c.origin === 'auto' && c.isOpen === true));
  assert.equal(notifyCalls.cancelled.length, 1);
  assert.equal(notifyCalls.cancelled[0].date, d(5));
  assert.equal(notifyCalls.cancelled[0].reason, 'deleted');
});

test('배정 건과 같은 날짜의 미배정 유령 행은 신청이 없을 때만 삭제', async () => {
  db.event = [reservation('r1', d(1), d(3)), reservation('r2', d(3), d(4))];
  db.cleaning = [
    { id: 'assigned-3', ...cleaning({ date: d(3), cleanerId: 'cl1' }) },
    { id: 'ghost-3', ...cleaning({ date: d(3) }) },
    { id: 'assigned-4', ...cleaning({ date: d(4), cleanerId: 'cl1' }) },
    { id: 'ghost-4-with-app', ...cleaning({ date: d(4) }) },
  ];
  db.cleaningApplication = [{ id: 'a1', cleaningId: 'ghost-4-with-app', status: 'pending' }];

  await ensureCleaningsForProperty(P);

  const ids = db.cleaning.map(c => c.id);
  assert.ok(!ids.includes('ghost-3'));
  assert.ok(ids.includes('ghost-4-with-app'));
  assert.equal(notifyCalls.cancelled.length, 0);
});

test('Beds24 가 0건을 돌려주면 삭제를 건너뛴다', async () => {
  db.event = Array.from({ length: 20 }, (_, i) => reservation(String(i), d(i), d(i + 2)));
  seedBookingsPage([]);
  const r = await syncBeds24Property(P, '111');
  assert.equal(r.error, undefined);
  assert.equal(r.eventsRemoved, 0);
  assert.equal(db.event.length, 20);
});

test('절반 넘게 사라지면 삭제를 건너뛰고, 소수만 사라지면 삭제한다', async () => {
  db.event = Array.from({ length: 20 }, (_, i) => reservation(String(i), d(i), d(i + 2)));

  seedBookingsPage([0, 1, 2, 3, 4].map(i => booking(i, d(i), d(i + 2))));
  const r1 = await syncBeds24Property(P, '111');
  assert.equal(r1.eventsRemoved, 0);
  assert.equal(db.event.length, 20);

  seedBookingsPage(Array.from({ length: 18 }, (_, i) => booking(i, d(i), d(i + 2))));
  const r2 = await syncBeds24Property(P, '111');
  assert.equal(r2.eventsRemoved, 2);
  assert.deepEqual(db.event.map(e => e.id).filter(id => ['18', '19'].includes(id)), []);
});

test('조회 창 밖의 오래된 이벤트는 삭제 대상이 아니며 창은 1년 이상 되돌아본다', async () => {
  db.event = [reservation('old', d(-520), d(-518)), reservation('1', d(1), d(3)), reservation('2', d(4), d(6))];
  seedBookingsPage([booking(1, d(1), d(3)), booking(2, d(4), d(6))]);
  const r = await syncBeds24Property(P, '111');
  assert.equal(r.eventsRemoved, 0);
  assert.ok(db.event.some(e => e.id === 'old'));
  const search = fetchLog.find(l => l.url.includes('departureFrom='));
  const from = new URL(search!.url).searchParams.get('departureFrom')!;
  assert.ok(from < d(-380));
});

test('취소된 예약은 삭제되고 그 날짜의 배정 청소도 정리된다', async () => {
  db.event = [reservation('1', d(1), d(3)), reservation('2', d(5), d(7))];
  db.cleaning = [
    { id: 'c-3', ...cleaning({ date: d(3), cleanerId: 'cl1' }) },
    { id: 'c-7', ...cleaning({ date: d(7), cleanerId: 'cl1' }) },
  ];
  seedBookingsPage([booking(1, d(1), d(3)), booking(2, d(5), d(7), { status: 'cancelled' })]);

  const r = await syncBeds24Property(P, '111');

  assert.equal(r.eventsRemoved, 1);
  assert.ok(!db.event.some(e => e.id === '2'));
  const ids = db.cleaning.map(c => c.id);
  assert.ok(ids.includes('c-3'));
  assert.ok(!ids.includes('c-7'));
  assert.equal(notifyCalls.cancelled.length, 1);
  assert.equal(notifyCalls.cancelled[0].date, d(7));
});

test('메모가 "객실정비"로 시작하는 블랙아웃은 정비로 분류된다', async () => {
  seedBookingsPage([
    booking(10, d(1), d(2), { status: 'black', firstName: '', lastName: '', notes: '객실정비: 보일러 점검' }),
    booking(11, d(3), d(4), { status: 'black', firstName: '', lastName: '', notes: '' }),
  ]);
  await syncBeds24Property(P, '111');
  const m = db.event.find(e => e.originalUid === '10');
  const b = db.event.find(e => e.originalUid === '11');
  assert.equal(m?.type, 'block'); assert.equal(m?.source, 'maintenance'); assert.equal(m?.title, '객실정비');
  assert.deepEqual(m?.tags, ['maintenance']); assert.match(m?.description, /사유: 보일러 점검/);
  assert.equal(b?.source, 'manual-block'); assert.equal(b?.title, '차단');
  assert.equal(db.cleaning?.length ?? 0, 0, '차단은 청소를 만들지 않는다');
});

test('success=false 응답은 오류로 처리하고 아무것도 지우지 않는다', async () => {
  db.event = [reservation('1', d(1), d(3))];
  installBeds24Mock({ onSearch: () => json({ success: false, error: 'invalid token' }) });
  const r = await syncBeds24Property(P, '111');
  assert.match(r.error ?? '', /invalid token/);
  assert.equal(db.event.length, 1);
  assert.ok(!calls.includes('event.delete'));
});
