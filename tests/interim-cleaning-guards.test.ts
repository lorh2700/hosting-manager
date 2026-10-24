import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsCleaner } from './stubs/auth';
import { resetNotify, notifyCalls } from './stubs/notify';
import { callRoute, installBeds24Mock, makeRequest, postsTo, resetFetch } from './helpers/beds24-mock';
import { todayKst, addDaysToDateStr } from '../lib/dates';
import { notifyCheckoutRecipients } from '../lib/checkout';
import { availableCheckoutCleanings } from '../lib/cleaning-schedule';
import { ensureCleaningsForProperty } from '../lib/sync-engine';
import { GET as calendar } from '../app/api/admin/calendar/route';
import { GET as today } from '../app/api/ops/today/route';
import { GET as cleanerToday } from '../app/api/cleaner/today/route';
import { GET as listCleanings, POST as createCleaning, PUT as updateCleaning, DELETE as deleteCleaning } from '../app/api/cleanings/route';
import { POST as applyCleaning } from '../app/api/cleaning-applications/route';
import { POST as padComplete } from '../app/api/public/welcomepad/cleanings/done/route';

const date = todayKst(), next = addDaysToDateStr(date, 1);
const cleaning = (id: string, origin: string, extra: Record<string, unknown> = {}) => ({ id, origin, propertyId: 'p', date, status: 'pending', cleanerId: null, isOpen: true, completedAt: null, ...extra });
const reservation = (endDate = date) => ({ id: 'stay', propertyId: 'p', channelId: 'beds24', originalUid: '123', title: '퇴실 게스트', type: 'reservation', tags: [], startDate: addDaysToDateStr(date, -3), endDate });

beforeEach(() => {
  resetDb(); resetNotify(); resetFetch(); actAsAdmin(); installBeds24Mock();
  process.env.WELCOMEPAD_API_KEY = 'interim-pad-test';
  db.property = [{ id: 'p', name: '숙소', ownerId: 'host', welcomepadKey: 'anon', roomReadyMessage: 'Ready' }];
});

test('interim cleaning survives missing reservations and never stands in for generated checkout cleaning', async () => {
  db.cleaning = [cleaning('interim', 'interim', { cleanerId: 'staff', date: next })];
  assert.deepEqual(await ensureCleaningsForProperty('p'), []);
  assert.equal(db.cleaning[0].id, 'interim');
  db.event = [reservation(next)];
  assert.deepEqual(await ensureCleaningsForProperty('p'), [next]);
  assert.equal(db.cleaning.length, 2); assert.ok(db.cleaning.some(row => row.origin === 'auto' && row.date === next));
  assert.deepEqual(await ensureCleaningsForProperty('p'), []);
  assert.equal(db.cleaning.length, 2); assert.equal(notifyCalls.cancelled.length, 0);
  db.event = [];
  await ensureCleaningsForProperty('p');
  assert.deepEqual(db.cleaning.map(row => row.id), ['interim']);
});

test('assigned interim does not delete an unassigned checkout schedule as a ghost', async () => {
  db.event = [reservation(next)];
  db.cleaning = [cleaning('interim', 'interim', { date: next, cleanerId: 'staff' }), cleaning('checkout', 'auto', { date: next })];
  assert.deepEqual(await ensureCleaningsForProperty('p'), []);
  assert.deepEqual(db.cleaning.map(row => row.id).sort(), ['checkout', 'interim']);
});

test('legacy reservation calendar excludes interim while retaining ordinary manual and external cleaning', async () => {
  db.event = [reservation()];
  db.cleaning = ['interim', 'auto', 'manual', 'external'].map(origin => cleaning(origin, origin));
  db.cleaning.push(cleaning('cancelled', 'manual', { status: 'cancelled' }));
  const result = await callRoute(calendar, new Request(`http://test/api/admin/calendar?month=${date.slice(0, 7)}`));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.cleanings.map((row: { id: string }) => row.id).sort(), ['auto', 'external', 'manual']);
});

test('today readiness cannot become done merely because an interim cleaning is complete', async () => {
  db.event = [reservation()];
  db.cleaning = [cleaning('interim', 'interim', { status: 'done', cleanerId: 'staff', createdAt: new Date() })];
  const first = await callRoute(today, new Request('http://test/api/ops/today?view=details'));
  assert.equal(first.status, 200); assert.equal(first.body.properties[0].cleaning, null);
  db.cleaning.push(cleaning('checkout', 'auto', { createdAt: new Date(0) }));
  const second = await callRoute(today, new Request('http://test/api/ops/today?view=details'));
  assert.equal(second.body.properties[0].cleaning.id, 'checkout'); assert.equal(second.body.properties[0].cleaning.status, 'pending');
});

test('pad readiness completion never changes interim or sends a check-in message', async () => {
  const request = () => new Request('http://test/api/public/welcomepad/cleanings/done', { method: 'POST', headers: { 'x-api-key': 'interim-pad-test', 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyKey: 'anon', action: 'complete' }) });
  db.cleaning = [cleaning('interim', 'interim', { cleanerId: 'staff' })];
  assert.equal((await padComplete(request())).status, 409); assert.equal(db.cleaning[0].status, 'pending');
  db.cleaning.push(cleaning('checkout', 'manual'));
  assert.equal((await padComplete(request())).status, 200);
  assert.equal(db.cleaning[0].status, 'pending'); assert.equal(db.cleaning[1].status, 'done'); assert.equal(postsTo('/bookings/messages').length, 0);
});

test('interim does not block a normal manual schedule, and open checkout applications remain independent', async () => {
  db.cleaning = [cleaning('interim', 'interim', { cleanerId: 'another' })];
  const created = await callRoute(createCleaning, makeRequest({ propertyId: 'p', date }));
  assert.equal(created.status, 201); assert.equal(created.body.origin, 'manual');
  const repeated = await callRoute(createCleaning, makeRequest({ propertyId: 'p', date }));
  assert.equal(repeated.status, 409);
  actAsCleaner(['p']);
  const available = await callRoute(listCleanings, new Request('http://test/api/cleanings?work=cleaner&isOpen=true'));
  assert.equal(available.body.length, 1); assert.equal(available.body[0].id, created.body.id);
  assert.equal((await callRoute(applyCleaning, makeRequest({ cleaningId: created.body.id }))).status, 201);
  db.cleaning[0].cleanerId = null;
  assert.equal((await callRoute(applyCleaning, makeRequest({ cleaningId: 'interim' }))).status, 409);
  assert.equal(db.cleaning[0].cleanerId, null);
});

test('cleaner task list retains interim without attaching the same-day departing guest', async () => {
  actAsCleaner(['p']);
  db.event = [reservation()];
  db.cleaning = [cleaning('interim', 'interim', { cleanerId: 'cleaner-1', status: 'done' })];
  const interimOnly = await callRoute(cleanerToday, new Request('http://test/api/cleaner/today'));
  assert.deepEqual(interimOnly.body.todayCleanings, []);
  assert.equal(interimOnly.body.tasks[0].cleaningId, 'interim');
  assert.equal(interimOnly.body.tasks[0].status, 'done');
  assert.equal(interimOnly.body.tasks[0].origin, 'interim');
  assert.equal(interimOnly.body.tasks[0].kind, 'interim');
  db.cleaning.push(cleaning('checkout', 'manual', { cleanerId: 'cleaner-1' }));
  const result = await callRoute(cleanerToday, new Request('http://test/api/cleaner/today'));
  assert.equal(result.status, 200);
  assert.equal(result.body.todayCleanings.length, 1);
  assert.equal(result.body.todayCleanings[0].id, 'checkout');
  assert.equal(result.body.todayCleanings[0].status, 'pending');
  assert.equal(result.body.tasks.find((row: { cleaningId: string }) => row.cleaningId === 'interim').guestName, '');
  assert.equal(result.body.tasks.find((row: { cleaningId: string }) => row.cleaningId === 'checkout').guestName, '퇴실 게스트');
  assert.equal(result.body.tasks.find((row: { cleaningId: string }) => row.cleaningId === 'checkout').kind, 'checkout');
});

test('cancelled interim never appears as pending work in legacy today or default cleaning lists', async () => {
  actAsCleaner(['p']);
  db.cleaning = [
    cleaning('cancelled', 'interim', { cleanerId: 'cleaner-1', status: 'cancelled' }),
    cleaning('interim', 'interim', { cleanerId: 'cleaner-1' }),
    cleaning('checkout', 'auto', { cleanerId: 'cleaner-1' }),
  ];
  const result = await callRoute(cleanerToday, new Request('http://test/api/cleaner/today'));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.tasks.map((row: { cleaningId: string }) => row.cleaningId).sort(), ['checkout', 'interim']);
  assert.deepEqual(result.body.todayCleanings.map((row: { id: string }) => row.id), ['checkout']);
  const list = await callRoute(listCleanings, new Request('http://test/api/cleanings?work=cleaner'));
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((row: { id: string }) => row.id).sort(), ['checkout', 'interim']);
});

test('legacy PUT and DELETE cannot mutate interim records in any state or revive cancelled work', async () => {
  db.cleaning = ['pending', 'done', 'cancelled'].map(status => cleaning(status, 'interim', { status, cleanerId: 'cleaner-1' }));
  const original = structuredClone(db.cleaning);
  for (const id of ['pending', 'done', 'cancelled']) {
    const updated = await callRoute(updateCleaning, makeRequest({ id, status: 'done', completedAt: new Date().toISOString() }));
    assert.equal(updated.status, 409); assert.match(updated.body.error, /통합 캘린더/);
    const removed = await callRoute(deleteCleaning, new Request(`http://test/api/cleanings?id=${id}`, { method: 'DELETE' }));
    assert.equal(removed.status, 409);
  }
  actAsCleaner(['p']);
  const own = await callRoute(updateCleaning, makeRequest({ id: 'cancelled', status: 'done' }));
  assert.equal(own.status, 409);
  assert.deepEqual(db.cleaning, original);
  assert.equal(notifyCalls.assigned.length, 0);
  assert.equal(notifyCalls.cancelled.length, 0);
  assert.equal(postsTo('/bookings/messages').length, 0);
});

test('checkout notification uses checkout assignees, never the same-day interim assignee', async () => {
  db.user = [
    { id: 'interim-staff', displayName: '중간청소 담당자', phone: '01000000001' },
    { id: 'checkout-staff', displayName: '퇴실청소 담당자', phone: '01000000002' },
  ];
  db.cleaning = [cleaning('interim', 'interim', { cleanerId: 'interim-staff' }), cleaning('checkout', 'manual', { cleanerId: 'checkout-staff' })];
  const result = await notifyCheckoutRecipients({ propertyId: 'p', date, kind: 'host', at: new Date() });
  assert.deepEqual(result.recipients, ['01000000002']);
  assert.equal(result.notified, 1);
  assert.deepEqual(notifyCalls.checkout.map(call => call.phone), ['01000000002']);
});

test('an interim assignee does not suppress fallback checkout notifications for eligible staff', async () => {
  db.user = [
    { id: 'interim-staff', displayName: '중간청소 담당자', phone: '01000000001', role: 'cleaner', status: 'active', notifyNewOpen: false },
    { id: 'available-staff', displayName: '근무 담당자', phone: '01000000003', role: 'cleaner', status: 'active', notifyNewOpen: true },
  ];
  db.userProperty = [{ userId: 'interim-staff', propertyId: 'p' }, { userId: 'available-staff', propertyId: 'p' }];
  db.cleaning = [cleaning('interim', 'interim', { cleanerId: 'interim-staff' })];
  const result = await notifyCheckoutRecipients({ propertyId: 'p', date, kind: 'host', at: new Date() });
  assert.deepEqual(result.recipients, ['01000000003']);
  assert.deepEqual(notifyCalls.checkout.map(call => call.phone), ['01000000003']);
});

test('schedule availability hides interim and compares assignments only within checkout work', () => {
  const row = (id: string, origin: string, propertyId: string, cleanerId: string | null = null) => ({ id, origin, propertyId, cleanerId, date, status: 'pending' });
  const rows = [
    row('interim-assigned', 'interim', 'p', 'staff'), row('interim-open', 'interim', 'p'), row('checkout', 'auto', 'p'),
    row('manual-assigned', 'manual', 'other', 'staff'), row('other-auto', 'auto', 'other'), row('external', 'external', 'third'),
    { ...row('done', 'auto', 'done-property'), status: 'done' },
    { ...row('past', 'auto', 'past-property'), date: addDaysToDateStr(date, -1) },
    { ...row('future', 'auto', 'future-property'), date: addDaysToDateStr(next, 1) },
  ];
  assert.deepEqual(availableCheckoutCleanings(rows, date, next).map(item => item.id), ['checkout', 'external']);
});
