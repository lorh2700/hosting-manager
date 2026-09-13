import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb, calls } from './stubs/prisma';
import { actAsAdmin, actAsManager } from './stubs/auth';
import { callRoute, makeRequest } from './helpers/beds24-mock';
import { GET } from '../app/api/ops/today/route';
import { todayKst } from '../lib/dates';
beforeEach(() => { resetDb(); actAsAdmin(); });
test('summary keeps arrival data and ready message without reading camera media', async () => {
 const today = todayKst();
 db.property = [{ id: 'p1', name: 'Test stay', ownerId: 'host', roomReadyMessage: 'Ready for arrival' }];
 db.event = [{ id: 'e1', propertyId: 'p1', type: 'reservation', title: 'Guest', startDate: today, endDate: '2027-01-01', channelId: 'beds24', tags: [] }];
 db.message = [{ id: 'm1', eventId: 'e1', type: 'message', sender: 'host', text: 'Ready for arrival', deliveryStatus: 'failed', createdAt: new Date() }];
 db.cameraSnapshot = [{ id: 'photo', propertyId: 'p1', date: today, capturedAt: new Date(), storagePath: 'photo.jpg' }];
 const result = await callRoute(GET, makeRequest({}, 'http://localhost/api/ops/today?view=summary'));
 assert.equal(result.status, 200);
 assert.equal(result.body.properties[0].readyMessage, 'Ready for arrival');
 assert.equal(result.body.properties[0].checkins[0].readyDelivery, 'failed');
 assert.deepEqual(result.body.properties[0].camera, []);
 assert.ok(!calls.includes('cameraSnapshot.findMany'));
 assert.ok(!calls.some(c => c.startsWith('POST /storage')));
});

test('camera view returns only latest three per visible property without operational queries', async () => {
 actAsManager(['p1', 'p2']);
 const today = todayKst();
 db.property = ['p1', 'p2', 'private'].map(id => ({ id, name: id, ownerId: 'host' }));
 db.cameraSnapshot = ['p1', 'p2', 'private'].flatMap(propertyId => Array.from({ length: 5 }, (_, i) => ({
  id: `${propertyId}-${i}`, propertyId, date: today, capturedAt: new Date(`2026-09-13T0${i}:00:00Z`), storagePath: `${propertyId}/${i}.jpg`, leaving: false, verdict: null,
 })));
 const result = await callRoute(GET, makeRequest({}, 'http://localhost/api/ops/today?view=cameras'));
 assert.equal(result.status, 200);
 assert.deepEqual(result.body.properties.map((p: any) => p.id), ['p1', 'p2']);
 for (const p of result.body.properties) assert.deepEqual(p.camera.map((c: any) => c.id), [`${p.id}-4`, `${p.id}-3`, `${p.id}-2`]);
 assert.ok(!calls.includes('event.findMany'));
 assert.ok(!calls.includes('message.findMany'));
 assert.ok(!calls.includes('cleaning.findMany'));
});
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
