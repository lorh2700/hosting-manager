import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/admin/calendar/route';
import { GET as getSupplies } from '../app/api/admin/calendar/supply-todos/route';
import { calendarGridRange, calendarMonthRange } from '../lib/calendar-month';
import { kstYearMonth, monthRange } from '../lib/dates';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsAnonymous, actAsManager } from './stubs/auth';
import { callRoute } from './helpers/beds24-mock';

beforeEach(() => {
  resetDb();
  actAsAdmin();
  db.property = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];
  const stays = [
    ['before', '2026-08-01', '2026-08-31'],
    ['checkout', '2026-08-30', '2026-09-01'],
    ['inside', '2026-09-12', '2026-09-15'],
    ['across', '2026-08-30', '2026-10-02'],
    ['after', '2026-10-01', '2026-10-03'],
  ];
  db.event = stays.map(([id, startDate, endDate]) => ({ id, propertyId: 'p1', startDate, endDate }));
  db.booking = stays.map(([id, checkIn, checkOut]) => ({ id, propertyId: 'p1', checkIn, checkOut, status: 'confirmed' }));
  db.cleaning = ['2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01'].map(date => ({ id: date, propertyId: 'p1', date }));
  db.supplyTodo = db.cleaning.map(row => ({ ...row }));
});

const request = (month: string) => new Request(`https://example.com/api/admin/calendar?month=${month}`);
const ids = (rows: { id: string }[]) => rows.map(row => row.id).sort();

test('calendar returns stays in the visible month grid, including boundary overlaps', async () => {
  const response = await callRoute(GET, request('2026-09'));
  assert.equal(response.status, 200);
  const data = response.body;
  assert.deepEqual(ids(data.events), ['across', 'after', 'before', 'checkout', 'inside']);
  assert.deepEqual(ids(data.bookings), ['across', 'after', 'before', 'checkout', 'inside']);
  assert.deepEqual(ids(data.cleanings), ['2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01']);
  const october = (await callRoute(GET, request('2026-10'))).body;
  assert.deepEqual(ids(october.events), ['across', 'after']);
  assert.deepEqual(ids(october.cleanings), ['2026-09-30', '2026-10-01']);
});

test('supply todos use the same month boundaries', async () => {
  const response = await callRoute(getSupplies, request('2026-09'));
  assert.equal(response.status, 200);
  assert.deepEqual(ids(response.body.supplyTodos), ['2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01']);
});

test('월을 넘기는 예약의 퇴실일 청소도 반환하되 다른 숙소와 무관한 날짜는 제외한다', async () => {
  db.booking.push({id:'long',propertyId:'p1',checkIn:'2026-09-29',checkOut:'2026-11-02',status:'confirmed'});
  db.cleaning.push(
    { id: 'linked-checkout', propertyId: 'p1', date: '2026-11-02', status: 'pending', cleanerId: 'cleaner-1' },
    { id: 'unrelated-date', propertyId: 'p1', date: '2026-11-03', status: 'pending' },
    { id: 'other-property', propertyId: 'p2', date: '2026-11-02', status: 'pending' },
  );
  const response = await callRoute(GET, request('2026-09'));
  assert.equal(response.status, 200);
  assert.deepEqual(ids(response.body.cleanings), ['2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01', 'linked-checkout']);
  actAsManager(['p2']);
  const scoped = await callRoute(GET, request('2026-09'));
  assert.deepEqual(scoped.body.cleanings, []);
});

test('month validation, leap years, year boundaries and default current month', async () => {
  assert.deepEqual(calendarMonthRange('2028-02'), { first: '2028-02-01', last: '2028-02-29' });
  assert.deepEqual(calendarMonthRange('2026-12'), { first: '2026-12-01', last: '2026-12-31' });
  const { year, month } = kstYearMonth();
  assert.deepEqual(calendarMonthRange(null), monthRange(year, month));
  for (const invalid of ['2026-00', '2026-13', '2026-9', 'all', '']) {
    assert.equal((await callRoute(GET, request(invalid))).status, 400);
    assert.equal((await callRoute(getSupplies, request(invalid))).status, 400);
  }
});

test('both monthly endpoints retain authentication and property scope', async () => {
  actAsManager(['p2']);
  const data = (await callRoute(GET, request('2026-09'))).body;
  assert.deepEqual(ids(data.properties), ['p2']);
  assert.deepEqual(data.events, []);
  assert.deepEqual(data.bookings, []);
  assert.deepEqual(data.cleanings, []);
  assert.deepEqual((await callRoute(getSupplies, request('2026-09'))).body.supplyTodos, []);
  actAsAnonymous();
  assert.equal((await callRoute(GET, request('2026-09'))).status, 401);
  assert.equal((await callRoute(getSupplies, request('2026-09'))).status, 401);
});

test('October 2 assignment is identical from September and October grids', async()=>{
 db.cleaning.push({id:'assigned',propertyId:'p1',date:'2026-10-02',cleanerId:'u',status:'pending'});
 const september=(await callRoute(GET,request('2026-09'))).body;
 const october=(await callRoute(GET,request('2026-10'))).body;
 assert.deepEqual(september.cleanings.find((c:any)=>c.id==='assigned'),october.cleanings.find((c:any)=>c.id==='assigned'));
 assert.ok(september.events.some((e:any)=>e.id==='after'));
});

test('a Sunday-start month includes the preceding mobile week with its cleaning and supplies', async () => {
  assert.deepEqual(calendarGridRange('2026-11'), { first: '2026-10-26', last: '2026-12-06' });
  db.event = [
    { id: 'mobile-week', propertyId: 'p1', startDate: '2026-10-26', endDate: '2026-10-30', type: 'reservation' },
    { id: 'too-early', propertyId: 'p1', startDate: '2026-10-20', endDate: '2026-10-25', type: 'reservation' },
  ];
  db.booking = [];
  db.cleaning = [
    { id: 'week-cleaning', propertyId: 'p1', date: '2026-10-30', cleanerId: 'u', status: 'pending' },
    { id: 'early-cleaning', propertyId: 'p1', date: '2026-10-25', cleanerId: 'u', status: 'pending' },
  ];
  db.supplyTodo = [
    { id: 'week-supply', propertyId: 'p1', date: '2026-10-30' },
    { id: 'early-supply', propertyId: 'p1', date: '2026-10-25' },
  ];
  const data = (await callRoute(GET, request('2026-11'))).body;
  assert.deepEqual(ids(data.events), ['mobile-week']);
  assert.deepEqual(ids(data.cleanings), ['week-cleaning']);
  assert.deepEqual(ids((await callRoute(getSupplies, request('2026-11'))).body.supplyTodos), ['week-supply']);
});

test('a Saturday-end month includes the next Sunday but excludes unrelated later dates', async () => {
  assert.deepEqual(calendarGridRange('2026-10'), { first: '2026-09-27', last: '2026-11-01' });
  db.event = [
    { id: 'sunday', propertyId: 'p1', startDate: '2026-11-01', endDate: '2026-11-02', type: 'reservation' },
    { id: 'too-late', propertyId: 'p1', startDate: '2026-11-02', endDate: '2026-11-03', type: 'reservation' },
  ];
  db.booking = [];
  db.cleaning = [
    { id: 'sunday-cleaning', propertyId: 'p1', date: '2026-11-01', cleanerId: 'u', status: 'pending' },
    { id: 'linked-checkout', propertyId: 'p1', date: '2026-11-02', cleanerId: 'u', status: 'pending' },
    { id: 'later-cleaning', propertyId: 'p1', date: '2026-11-03', cleanerId: 'u', status: 'pending' },
  ];
  db.supplyTodo = [
    { id: 'sunday-supply', propertyId: 'p1', date: '2026-11-01' },
    { id: 'later-supply', propertyId: 'p1', date: '2026-11-02' },
  ];
  const data = (await callRoute(GET, request('2026-10'))).body;
  assert.deepEqual(ids(data.events), ['sunday']);
  assert.deepEqual(ids(data.cleanings), ['linked-checkout', 'sunday-cleaning']);
  assert.deepEqual(ids((await callRoute(getSupplies, request('2026-10'))).body.supplyTodos), ['sunday-supply']);
});

test('display ranges cover all monthly and mobile weekly cells within at most 43 days', () => {
  const day = 86400000;
  for (let year = 2026; year <= 2028; year++) {
    for (let month = 1; month <= 12; month++) {
      const range = calendarGridRange(`${year}-${String(month).padStart(2, '0')}`);
      const first = new Date(`${range.first}T00:00:00Z`).getTime();
      const last = new Date(`${range.last}T00:00:00Z`).getTime();
      assert.ok((last - first) / day + 1 <= 43);
      for (let date = Date.UTC(year, month - 1, 1); new Date(date).getUTCMonth() === month - 1; date += day) {
        const weekday = new Date(date).getUTCDay();
        const sundayStart = date - weekday * day;
        const mondayStart = date - ((weekday + 6) % 7) * day;
        assert.ok(first <= sundayStart && last >= sundayStart + 6 * day);
        assert.ok(first <= mondayStart && last >= mondayStart + 6 * day);
      }
    }
  }
});
