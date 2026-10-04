import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/ops/today/route';
import { prisma } from './stubs/prisma';
import { db, calls, prismaOverrides, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsCleaner, actAsManager, authState } from './stubs/auth';
import { todayKst } from '../lib/dates';
import { opsActionsBlocked } from '../lib/ops-freshness';
import { listAssignees } from '../lib/staff-directory';

const today = todayKst();
beforeEach(() => {
  resetDb(); actAsAdmin();
  db.property = [{ id: 'p', name: 'Test stay', roomReadyMessage: 'Ready' }];
  db.event = [{ id: 'e', propertyId: 'p', title: 'Guest 예약', type: 'reservation', tags: [],
    startDate: today, endDate: '2099-01-01', channelId: 'beds24', originalUid: '42' }];
});
async function read(query: string) {
  const response = await GET(new Request(`http://test/api/ops/today?${query}`), { params: Promise.resolve({}) });
  return { response, status: response.status, body: (response as unknown as { body: any }).body };
}

test('board keeps cleaning, checkout, pets and delivery while deferring unused queries', async () => {
  db.user = [{ id: 'cleaner', displayName: '현정', role: 'cleaner', status: 'active' }];
  db.cleaning = [{ id: 'c', propertyId: 'p', date: today, cleanerId: 'cleaner', status: 'done',
    supplies: '수건', notes: '확인', createdAt: new Date() }];
  db.checkoutSignal = [{ id: 'signal', propertyId: 'p', date: today, kind: 'guest_pad', at: new Date(), note: '퇴실' }];
  db.booking = [{ id: 'b', propertyId: 'p', status: 'confirmed', name: 'Guest', checkIn: today,
    checkOut: '2099-01-01', channelBookingRef: '42', checkout: { beds24Id: '42', stayOptions: {
      version: 1, baseGuests: 2, basePriceKrw: 100000, extraGuests: 0, extraGuestFeeKrw: 0, pets: 1, petFeeKrw: 70000,
    } } }];
  db.message = [{ id: 'sent', eventId: 'e', sender: 'host', type: 'message', text: 'Ready', deliveryStatus: 'failed', createdAt: new Date(0) },
    { id: 'guest', eventId: 'e', sender: 'guest', type: 'message', text: 'early check-in', read: false, createdAt: new Date() }];
  const { body, response } = await read('view=board');
  const property = body.properties[0], guest = property.checkins[0];
  assert.equal(body.detailsLoaded, true); assert.equal(body.cleanersLoaded, false);
  assert.deepEqual(body.cleaners, []); assert.deepEqual(body.unavailable, []);
  assert.equal(property.cleaning.cleanerName, '현정'); assert.equal(property.cleaning.status, 'done');
  assert.equal(property.checkoutStatus.confirmed, true);
  assert.equal(guest.pets, 1); assert.equal(guest.readyDelivery, 'failed'); assert.equal(guest.unread, 1);
  assert.equal(guest.messagesLoaded, false); assert.equal(guest.messagesAvailable, false);
  assert.deepEqual(guest.messages, []); assert.deepEqual(guest.flags, []);
  assert.equal(body.counts.pendingApplications, null);
  assert.equal(opsActionsBlocked({ ...body, refreshing: false, loadError: false }), false);
  assert.ok(!calls.includes('user.findMany'));
  assert.ok(!calls.some(call => /cleaningApplication|cleaningIssue|supplyTodo|cameraSnapshot/.test(call)));
  assert.equal(calls.filter(call => call === 'message.findMany').length, 1);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('a metadata outage remains an unsafe state rather than deferred conversation', async () => {
  const message = prisma.message;
  prismaOverrides.message = { ...message, groupBy: async () => { throw new Error('unread unavailable'); } };
  const { status, body } = await read('view=board');
  assert.equal(status, 200); assert.equal(body.properties[0].checkins.length, 1);
  assert.ok(body.unavailable.includes('messages'));
  assert.equal(opsActionsBlocked({ ...body, refreshing: false, loadError: false }), true);
});

test('conversation fetch reads only four latest messages for one visible today guest', async () => {
  actAsManager(['p']);
  db.message = Array.from({ length: 8 }, (_, index) => ({ id: `m${index}`, eventId: 'e', type: 'message',
    sender: 'guest', text: index === 7 ? 'Can we check in early?' : `message ${index}`, createdAt: new Date(index * 1000) }));
  db.message.push({ id: 'memo', eventId: 'e', type: 'memo', sender: 'host', text: 'private memo', createdAt: new Date() });
  const { body, response } = await read('view=conversation&eventId=e');
  assert.equal(body.eventId, 'e'); assert.equal(body.today, today); assert.equal(body.messagesLoaded, true);
  assert.equal(body.messagesAvailable, true); assert.deepEqual(body.messages.map((item: any) => item.id), ['m4', 'm5', 'm6', 'm7']);
  assert.ok(body.flags.length > 0);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(calls, ['event.findFirst', 'message.findMany']);
});

test('conversation endpoint cannot read a private, other-day or inquiry reservation', async () => {
  actAsManager(['p']);
  const current = { ...db.event[0] };
  for (const change of [{ propertyId: 'private' }, { startDate: '2000-01-01', endDate: '2000-01-02' },
    { tags: ['inquiry'] }, { title: '[문의] Guest' }, { type: 'memo' }, { channelId: 'direct' }]) {
    db.event = [{ ...current, ...change }]; calls.length = 0;
    assert.equal((await read('view=conversation&eventId=e')).status, 404);
    assert.ok(!calls.includes('message.findMany'));
  }
  assert.equal((await read('view=conversation')).status, 400);
});

test('assignees query is scoped and lean, and uses an already resolved scope', async () => {
  actAsManager(['p']);
  db.user = [
    { id: 'admin', displayName: 'Admin', role: 'super_admin', status: 'active' },
    { id: 'cleaner', displayName: '현정', role: 'cleaner', status: 'active' },
    { id: 'legacy', displayName: '', email: 'legacy@test', role: 'host', status: 'no_account' },
    { id: 'private', displayName: 'Private', role: 'cleaner', status: 'active' },
    { id: 'stopped', displayName: 'Stopped', role: 'cleaner', status: 'suspended' },
  ];
  db.userProperty = [{ userId: 'cleaner', propertyId: 'p' }, { userId: 'legacy', propertyId: 'p' },
    { userId: 'private', propertyId: 'private' }, { userId: 'stopped', propertyId: 'p' }];
  const user = prisma.user;
  let args: any;
  prismaOverrides.user = { ...user, findMany: async (input: any) => { args = input; return user.findMany(input); } };
  const { status, body, response } = await read('view=assignees');
  assert.equal(status, 200); assert.equal(body.cleanersLoaded, true);
  assert.deepEqual(body.cleaners.map((item: any) => item.id).sort(), ['cleaner', 'legacy']);
  assert.equal(body.cleaners.find((item: any) => item.id === 'legacy').name, 'legacy@test');
  assert.deepEqual(args.where.OR[1], { properties: { some: { propertyId: { in: ['p'] } } } });
  assert.equal(args.select.publicToken, undefined); assert.equal(args.select.ownerId, undefined);
  // The lazy reservation endpoint must separately validate the cleaning option.
  assert.deepEqual(calls, ['property.findMany', 'user.findMany']);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  calls.length = 0;
  assert.deepEqual(await listAssignees(authState.auth, []), []);
  assert.deepEqual(calls, []);
});

test('a cleaner caller can reuse verified scope without resolving identity links twice', async () => {
  actAsCleaner(['p']);
  calls.length = 0;
  assert.deepEqual((await listAssignees(authState.auth, ['p'])).map(user => user.id), ['cleaner-1']);
  assert.deepEqual(calls, ['user.findMany']);
});

test('initial board overlaps independent reads but never exceeds the three-connection budget', async () => {
  let active = 0, peak = 0;
  const starts: string[] = [];
  const completions: string[] = [];
  for (const model of ['event', 'booking', 'cleaning', 'checkoutSignal', 'message']) {
    const original = prisma[model];
    prismaOverrides[model] = Object.fromEntries(Object.entries(original).map(([operation, fn]) => [operation, async (...args: any[]) => {
      active++; peak = Math.max(peak, active); starts.push(`${model}.${operation}`);
      try {
        await new Promise(resolve => setTimeout(resolve, model === 'event' || model === 'booking' ? 30 : 10));
        return await (fn as Function)(...args);
      } finally { active--; completions.push(`${model}.${operation}`); }
    }]));
  }
  await read('view=board');
  assert.equal(peak, 3); assert.equal(active, 0);
  assert.deepEqual(starts.slice(0, 3), ['event.findMany', 'booking.findMany', 'cleaning.findMany']);
  assert.equal(completions[0], 'cleaning.findMany');
});

test('controlled latency sample shows overview avoids per-guest message and staff reads', async () => {
  const event = db.event[0];
  db.property = Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, name: `Stay ${index}`, roomReadyMessage: 'Ready' }));
  db.event = db.property.map((property, index) => ({ ...event, id: `e${index}`, propertyId: property.id }));
  let active = 0, peak = 0;
  for (const model of ['property', 'event', 'booking', 'cleaning', 'checkoutSignal', 'user', 'message']) {
    const original = prisma[model];
    prismaOverrides[model] = Object.fromEntries(Object.entries(original).map(([operation, fn]) => [operation, async (...args: any[]) => {
      active++; peak = Math.max(peak, active);
      try { await new Promise(resolve => setTimeout(resolve, 20)); return await (fn as Function)(...args); }
      finally { active--; }
    }]));
  }
  const measure = async (view: string) => {
    calls.length = 0; peak = 0;
    const start = performance.now(); await read(`view=${view}&includeCounts=false`);
    return { elapsedMs: Math.round(performance.now() - start), queries: calls.length, peak };
  };
  const details = await measure('details'), board = await measure('board');
  assert.equal(details.queries - board.queries, 13); // 12 recent conversations and one assignee read.
  assert.equal(details.peak, 3); assert.equal(board.peak, 3);
  console.info('[ops/today controlled 20ms/read, 12 guests]', { details, board });
});
