import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/bookings/cancel/route';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsAnonymous, actAsManager } from './stubs/auth';
import { callRoute, setFetchHandler, resetFetch, json, fetchLog } from './helpers/beds24-mock';

function request(id = 'booking-1') {
  return new Request('https://voidanchae.com/api/bookings/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
}
beforeEach(() => {
  resetDb(); resetFetch(); actAsAdmin();
  db.property = [{ id: 'p1', beds24RoomId: '555' }];
  db.booking = [1, 2].map(i => ({ id: `booking-${i}`, propertyId: 'p1', source: 'direct', status: 'confirmed', checkIn: '2027-10-17', checkOut: '2027-10-18' }));
  setFetchHandler(() => { throw new Error('Unexpected network call'); });
});

test('only the selected duplicate direct booking is cancelled; repeating is safe', async () => {
  assert.equal((await callRoute(POST, request())).status, 200);
  assert.equal((await callRoute(POST, request())).status, 200);
  assert.equal(db.booking[0].status, 'cancelled');
  assert.equal(db.booking[1].status, 'confirmed');
  assert.equal(fetchLog.length, 0);
});

test('authentication, assigned property, OTA and payment checks protect cancellation', async () => {
  actAsAnonymous(); assert.equal((await callRoute(POST, request())).status, 401);
  actAsManager(['another']); assert.equal((await callRoute(POST, request())).status, 403);
  actAsAdmin(); db.booking[0].source = 'airbnb';
  assert.equal((await callRoute(POST, request())).status, 400);
  db.booking[0].source = 'direct';
  db.checkoutOrder = [{ id: 'paid', bookingId: 'booking-1', status: 'confirmed' }];
  assert.equal((await callRoute(POST, request())).status, 409);
  assert.equal(db.booking[0].status, 'confirmed');
});

test('Beds24 failure leaves the local reservation unchanged', async () => {
  db.booking[0].channelBookingRef = '123';
  assert.equal((await callRoute(POST, request())).status, 502);
  assert.equal(db.booking[0].status, 'confirmed');
});

test('linked direct booking verifies remote cancellation and removes only its matching event', async () => {
  db.booking[0].channelBookingRef = '123';
  db.event = [{ id: 'event-1', propertyId: 'p1', channelId: 'beds24', originalUid: '123', type: 'reservation', endDate: '2027-10-18' },
    { id: 'event-2', propertyId: 'p1', channelId: 'beds24', originalUid: '456', type: 'reservation', endDate: '2027-10-18' }];
  let status = 'confirmed';
  setFetchHandler((url, init) => {
    if (url.pathname.endsWith('/authentication/token')) return json({ token: 'token', expiresIn: 86400 });
    if (url.pathname.endsWith('/bookings') && init.method === 'POST') {
      assert.equal(JSON.parse(init.body!)[0].id, 123);
      status = 'cancelled'; return json([{ success: true }]);
    }
    if (url.pathname.endsWith('/bookings')) return json({ data: [{ id: 123, roomId: 555, status }] });
    throw new Error('Unexpected request');
  });
  assert.equal((await callRoute(POST, request())).status, 200);
  assert.equal(db.booking[0].status, 'cancelled');
  assert.deepEqual(db.event.map(e => e.id), ['event-2']);
});
