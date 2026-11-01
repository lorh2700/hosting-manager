import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/public/tour-bookings/route';
import { db, calls, resetDb, prismaOverrides } from './stubs/prisma';
import { notifyCalls, resetNotify } from './stubs/notify';
import { callRoute, makeRequest as baseRequest } from './helpers/beds24-mock';

let requestId = 0;
function makeRequest(body: unknown) {
  const request = baseRequest(body);
  request.headers.set('x-real-ip', `test-${++requestId}`);
  return request;
}

const inquiry = { tourId: 'tour-1', requestedDate: '2028-10-12', requestedTime: '14:30', name: '테스트', phone: '010-1234-5678', guests: 2 };
beforeEach(() => {
  resetDb(); resetNotify();
  db.tour = [{ id: 'tour-1', organizationId: 'org-a', title: '북촌 투어', isActive: true, maxGroupSize: 4, basePrice: 30000,
    durationOptions: [], ticketTiers: [], owner: { organizationId: 'org-a', phone: null, displayName: '담당자', email: 'host@example.com' } }];
});

test('a tour without schedules accepts an inquiry without reserving inventory', async () => {
  const response = await callRoute(POST, makeRequest(inquiry));
  assert.equal(response.status, 201);
  const saved = db.tourBooking[0];
  assert.equal(saved.requestedDate, inquiry.requestedDate);
  assert.equal(saved.requestedTime, inquiry.requestedTime);
  assert.equal(saved.status, 'pending');
  assert.equal(saved.source, 'inquiry');
  assert.equal(saved.totalPrice, 60000);
  assert.ok(!saved.scheduleId);
  assert.ok(!calls.some(call => call.startsWith('tourSchedule.')));
});

test('invalid dates, past times and missing contact cannot create inquiries', async () => {
  for (const change of [{ requestedDate: '2028-02-30' }, { requestedDate: '2020-01-01' }, { requestedTime: '25:00' }, { phone: '' }]) {
    const response = await callRoute(POST, makeRequest({ ...inquiry, ...change }));
    assert.equal(response.status, 400);
  }
  assert.equal(db.tourBooking?.length ?? 0, 0);
});

test('inactive tours and excessive group sizes are rejected', async () => {
  assert.equal((await callRoute(POST, makeRequest({ ...inquiry, guests: 5 }))).status, 400);
  db.tour[0].isActive = false;
  assert.equal((await callRoute(POST, makeRequest(inquiry))).status, 404);
});

test('public inquiry keeps customer contact separate from the configured host and exposes no recipient settings', async () => {
  db.tourNotificationSettings = [{ organizationId: 'org-a', phone: '+82 10-3333-4444' }];
  const response = await callRoute(POST, makeRequest(inquiry));
  assert.equal(response.status, 201);
  assert.equal(db.tourBooking[0].phone, inquiry.phone);
  assert.equal(notifyCalls.tourHost.length, 1);
  assert.equal(notifyCalls.tourHost[0].hostPhone, '01033334444');
  assert.equal(notifyCalls.tourHost[0].guestPhone, inquiry.phone);
  assert.equal(notifyCalls.tourGuest.length, 1);
  assert.equal(notifyCalls.tourGuest[0].guestPhone, inquiry.phone);
  assert.deepEqual(response.body, { success: true, bookingId: db.tourBooking[0].id });
  assert.doesNotMatch(JSON.stringify(response.body), /01033334444|org-a|hostPhone|settings/);
});

test('an unset operator number uses only the owner fallback and never the applicant number', async () => {
  db.tour[0].owner.phone = '+82 10 7777 8888';
  await callRoute(POST, makeRequest(inquiry));
  assert.equal(notifyCalls.tourHost[0].hostPhone, '01077778888');
  db.tour[0].owner.phone = null;
  await callRoute(POST, makeRequest(inquiry));
  assert.equal(notifyCalls.tourHost[1].hostPhone, null);
  assert.equal(notifyCalls.tourGuest[1].guestPhone, inquiry.phone);
});

test('public inquiry awaits recipient resolution before returning success', async () => {
  let release!: (value: { phone: string }) => void;
  prismaOverrides.tourNotificationSettings = { findUnique: () => new Promise(resolve => { release = resolve; }) };
  let settled = false;
  const pending = callRoute(POST, makeRequest(inquiry)).then(response => { settled = true; return response; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(notifyCalls.tourHost.length, 0);
  release({ phone: '01033334444' });
  assert.equal((await pending).status, 201);
  assert.equal(notifyCalls.tourHost.length, 1);
});
