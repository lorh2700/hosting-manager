import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsCleaner } from './stubs/auth';
import { resetNotify, notifyCalls } from './stubs/notify';
import { callRoute, makeRequest } from './helpers/beds24-mock';
import { GET as list, POST as create, PUT as update } from '../app/api/cleanings/route';
import { POST as apply } from '../app/api/cleaning-applications/route';
import { POST as cancel } from '../app/api/cleaning-applications/[id]/cancel/route';
import { GET as today } from '../app/api/cleaner/today/route';
import { ensureCleaningsForProperty } from '../lib/sync-engine';
import { availableCheckoutCleanings } from '../lib/cleaning-schedule';
import { todayKst, addDaysToDateStr } from '../lib/dates';

const date = addDaysToDateStr(todayKst(), 2);
const cleaning = (extra: Record<string, unknown> = {}) => ({ id: 'cleaning', propertyId: 'p', date, cleanerId: 'primary', assistantCleanerId: null,
  origin: 'manual', status: 'pending', completedAt: null, assignmentType: 'direct', assistantAssignmentType: null, ...extra });
beforeEach(() => {
  resetDb(); resetNotify(); actAsAdmin();
  db.property = [{ id: 'p', name: '숙소', owner: { phone: '01000000000' } }];
  db.cleaning = [cleaning()];
});

test('simultaneous registration and sync leave one checkout schedule', async () => {
  db.cleaning = []; db.event = [{ propertyId: 'p', type: 'reservation', endDate: date }];
  const [a, b] = await Promise.all([callRoute(create, makeRequest({ propertyId: 'p', date })), callRoute(create, makeRequest({ propertyId: 'p', date }))]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]); assert.equal(db.cleaning.length, 1);
  db.cleaning = [];
  await Promise.all([ensureCleaningsForProperty('p'), ensureCleaningsForProperty('p'), callRoute(create, makeRequest({ propertyId: 'p', date }))]);
  assert.equal(db.cleaning.length, 1);
});

test('assistant claims the same cleaning once and primary cannot fill both roles', async () => {
  actAsCleaner(['p']);
  const [a, b] = await Promise.all([callRoute(apply, makeRequest({ cleaningId: 'cleaning', role: 'assistant' })), callRoute(apply, makeRequest({ cleaningId: 'cleaning', role: 'assistant' }))]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(db.cleaning.length, 1); assert.equal(db.cleaning[0].cleanerId, 'primary'); assert.equal(db.cleaning[0].assistantCleanerId, 'cleaner-1');
  assert.equal(db.cleaningApplication.length, 1); assert.equal(db.cleaningApplication[0].role, 'assistant');
  assert.equal(notifyCalls.application[0].role, 'assistant');
  db.cleaning[0].assistantCleanerId = null; db.cleaning[0].cleanerId = 'cleaner-1';
  assert.equal((await callRoute(apply, makeRequest({ cleaningId: 'cleaning', role: 'assistant' }))).status, 409);
});

test('assistant can apply independently and cancellation preserves primary, task and history', async () => {
  actAsCleaner(['p']); db.cleaning[0].cleanerId = null;
  const applied = await callRoute(apply, makeRequest({ cleaningId: 'cleaning', role: 'assistant' }));
  assert.equal(applied.status, 201);
  db.cleaning[0].cleanerId = 'primary'; db.cleaningVisitPhoto = [{ id: 'photo', cleaningId: 'cleaning' }];
  const response = await cancel(makeRequest({ reason: '일정 변경' }), { params: Promise.resolve({ id: applied.body.applicationId }) });
  assert.equal(response.status, 200); assert.equal(db.cleaning[0].assistantCleanerId, null); assert.equal(db.cleaning[0].cleanerId, 'primary');
  assert.equal(db.cleaning[0].id, 'cleaning'); assert.equal(db.cleaningVisitPhoto[0].cleaningId, 'cleaning');
  assert.equal(db.cleaningApplication[0].status, 'cancelled'); assert.match(notifyCalls.sms[0].text, /부담당/);
});

test('changing primary preserves assistant and records, and assistant can complete existing task', async () => {
  db.cleaning[0].assistantCleanerId = 'cleaner-1'; db.cleaningVisitPhoto = [{ id: 'photo', cleaningId: 'cleaning' }];
  const cleared = await callRoute(update, makeRequest({ id: 'cleaning', cleanerId: null }));
  assert.equal(cleared.status, 200); assert.equal(db.cleaning[0].assistantCleanerId, 'cleaner-1'); assert.equal(db.cleaning.length, 1);
  actAsCleaner(['p']);
  const tasks = await callRoute(today, new Request('http://test/api/cleaner/today'));
  assert.equal(tasks.body.tasks[0].role, 'assistant');
  const completed = await callRoute(update, makeRequest({ id: 'cleaning', status: 'done' }));
  assert.equal(completed.status, 200); assert.equal(db.cleaning[0].status, 'done'); assert.ok(db.cleaning[0].completedAt);
  assert.equal(db.cleaningVisitPhoto[0].cleaningId, 'cleaning');
});

test('ambiguous legacy rows and occupied target dates refuse changes without deleting data', async () => {
  db.cleaning.push(cleaning({ id: 'duplicate', cleanerId: 'second' }));
  const before = structuredClone(db.cleaning);
  assert.equal((await callRoute(update, makeRequest({ id: 'cleaning', cleanerId: null }))).status, 409);
  actAsCleaner(['p']); assert.equal((await callRoute(apply, makeRequest({ cleaningId: 'cleaning', role: 'assistant' }))).status, 409);
  assert.deepEqual(db.cleaning, before);
  actAsAdmin(); db.cleaning[1].date = addDaysToDateStr(date, 1);
  assert.equal((await callRoute(update, makeRequest({ id: 'cleaning', date: db.cleaning[1].date }))).status, 409);
  assert.equal(db.cleaning[0].date, date);
});

test('sync preserves assigned and documented rows but removes an empty future auto duplicate', async () => {
  db.event = [{ propertyId: 'p', type: 'reservation', endDate: date }];
  db.cleaning = [cleaning(), cleaning({ id: 'empty', origin: 'auto', cleanerId: null }),
    cleaning({ id: 'photo', origin: 'auto', cleanerId: null }), cleaning({ id: 'assist', origin: 'auto', cleanerId: null, assistantCleanerId: 'helper' })];
  db.cleaningVisitPhoto = [{ id: 'proof', cleaningId: 'photo' }];
  await ensureCleaningsForProperty('p');
  assert.deepEqual(db.cleaning.map(row => row.id).sort(), ['assist', 'cleaning', 'photo']);
});

test('available role slots hide conflicts and existing self assignments', () => {
  const rows = [cleaning({ cleanerId: null }), cleaning({ id: 'other', propertyId: 'other', cleanerId: null, assistantCleanerId: 'cleaner-1' })];
  assert.deepEqual(availableCheckoutCleanings(rows, date, date, 'assistant', 'cleaner-1').map(row => row.id), ['cleaning']);
  assert.deepEqual(availableCheckoutCleanings(rows, date, date, 'primary', 'cleaner-1').map(row => row.id), ['cleaning']);
});

test('an external primary assignee occupies only the primary slot in availability and claims', async () => {
  actAsCleaner(['p']);
  db.cleaning = [cleaning({ cleanerId: null, origin: 'external', externalCleanerName: '외부 담당자' })];
  assert.deepEqual(availableCheckoutCleanings(db.cleaning as ReturnType<typeof cleaning>[], date, date, 'primary'), []);
  assert.equal(availableCheckoutCleanings(db.cleaning as ReturnType<typeof cleaning>[], date, date, 'assistant').length, 1);
  const primary = await callRoute(list, new Request('http://test/api/cleanings?work=cleaner&isOpen=true&role=primary'));
  assert.equal(primary.body.length, 0);
  assert.equal((await callRoute(apply, makeRequest({ cleaningId: 'cleaning', role: 'primary' }))).status, 409);
  assert.equal((await callRoute(apply, makeRequest({ cleaningId: 'cleaning', role: 'assistant' }))).status, 201);
  assert.equal(db.cleaning[0].cleanerId, null); assert.equal(db.cleaning[0].externalCleanerName, '외부 담당자');
});
