import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/public/tour-bookings/route';
import { db, calls, resetDb } from './stubs/prisma';
import { callRoute, makeRequest } from './helpers/beds24-mock';

const inquiry = { tourId: 'tour-1', requestedDate: '2028-10-12', requestedTime: '14:30', name: '테스트', phone: '010-1234-5678', guests: 2 };
beforeEach(() => {
  resetDb();
  db.tour = [{ id: 'tour-1', title: '북촌 투어', isActive: true, maxGroupSize: 4, basePrice: 30000,
    durationOptions: [], ticketTiers: [], owner: { phone: null, displayName: '담당자', email: 'host@example.com' } }];
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
