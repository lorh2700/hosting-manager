import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/admin/calendar/route';
import { GET as getSupplies } from '../app/api/admin/calendar/supply-todos/route';
import { calendarMonthRange } from '../lib/calendar-month';
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

test('calendar only returns the requested month, including stays crossing its boundaries', async () => {
  const response = await callRoute(GET, request('2026-09'));
  assert.equal(response.status, 200);
  const data = response.body;
  assert.deepEqual(ids(data.events), ['across', 'checkout', 'inside']);
  assert.deepEqual(ids(data.bookings), ['across', 'checkout', 'inside']);
  assert.deepEqual(ids(data.cleanings), ['2026-09-01', '2026-09-30']);
  const october = (await callRoute(GET, request('2026-10'))).body;
  assert.deepEqual(ids(october.events), ['across', 'after']);
  assert.deepEqual(ids(october.cleanings), ['2026-10-01']);
});

test('supply todos use the same month boundaries', async () => {
  const response = await callRoute(getSupplies, request('2026-09'));
  assert.equal(response.status, 200);
  assert.deepEqual(ids(response.body.supplyTodos), ['2026-09-01', '2026-09-30']);
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
