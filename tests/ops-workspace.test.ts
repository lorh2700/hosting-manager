import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin } from './stubs/auth';
import { callRoute, makeRequest } from './helpers/beds24-mock';
import { GET } from '../app/api/ops/today/route';
import { todayKst } from '../lib/dates';
beforeEach(() => { resetDb(); actAsAdmin(); });
test('workspace exposes failed room-ready delivery separately from completed cleaning', async () => {
 const today = todayKst();
 db.property = [{ id: 'p1', name: 'Test stay', ownerId: 'host', roomReadyMessage: 'Ready for arrival' }];
 db.event = [{ id: 'e1', propertyId: 'p1', type: 'reservation', title: 'Guest', startDate: today, endDate: '2027-01-01', channelId: 'beds24', tags: [] }];
 db.cleaning = [{ id: 'c1', propertyId: 'p1', date: today, status: 'done', createdAt: new Date() }];
 db.message = [{ id: 'm1', eventId: 'e1', type: 'message', sender: 'host', text: 'Ready for arrival', deliveryStatus: 'failed', createdAt: new Date() }];
 const result = await callRoute(GET, makeRequest({}));
 assert.equal(result.status, 200);
 assert.equal(result.body.properties[0].cleaning.status, 'done');
 assert.equal(result.body.properties[0].checkins[0].readyDelivery, 'failed');
});
test('ordinary sent chat does not imply room-ready notification was delivered', async () => {
 const today = todayKst();
 db.property = [{ id: 'p1', name: 'Test stay', ownerId: 'host', roomReadyMessage: 'Ready for arrival' }];
 db.event = [{ id: 'e1', propertyId: 'p1', type: 'reservation', title: 'Guest', startDate: today, endDate: '2027-01-01', channelId: 'beds24', tags: [] }];
 db.message = [{ id: 'm1', eventId: 'e1', type: 'message', sender: 'host', text: 'Hello', deliveryStatus: 'sent', createdAt: new Date() }];
 const result = await callRoute(GET, makeRequest({}));
 assert.equal(result.status, 200);
 assert.equal(result.body.properties[0].checkins[0].readyDelivery, null);
});
