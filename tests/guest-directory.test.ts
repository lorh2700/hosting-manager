import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/guests/directory/route';
import { summarizeReservations } from '../lib/guest-directory';
import { actAsAdmin, actAsManager } from './stubs/auth';
import { resetDb, db } from './stubs/prisma';
import { callRoute } from './helpers/beds24-mock';
beforeEach(() => { resetDb(); actAsAdmin(); });
const request = (query: string) => new Request(`http://localhost/api/guests/directory?${query}`);
test('server search covers later pages, null contacts and normalized phone formats', async () => {
  db.guest = Array.from({ length: 32 }, (_, i) => ({ id: `guest-${i}`, name: i === 31 ? '박도영' : `Customer ${i}`, email: null, phone: null, normalizedPhone: i === 31 ? '+821012345678' : null }));
  const response = await callRoute(GET, request('filter=all&q=01012345678'));
  assert.equal(response.status, 200); assert.equal(response.body.total, 1); assert.equal(response.body.rows[0].id, 'guest-31');
  const page = await callRoute(GET, request('filter=all&page=2'));
  assert.equal(page.body.total, 32); assert.equal(page.body.rows.length, 7);
});
test('detail only returns selected customer reservations and rejects managers', async () => {
  db.guest = [{ id: 'g', name: 'Test' }];
  db.guestReservation = [{ id: 'one', guestId: 'g', status: 'confirmed' }, { id: 'two', guestId: 'other', status: 'confirmed' }];
  const result = await callRoute(GET, request('id=g'));
  assert.equal(result.body.total, 1); assert.equal(result.body.rows[0].id, 'one');
  assert.equal((await callRoute(GET, request('id=missing'))).status, 404);
  actAsManager(['p']); assert.equal((await callRoute(GET, request('id=g'))).status, 403);
});
test('historical confirmed reservations are distinct from actual completed stays', () => {
  const row = { checkIn: '2025-01-01', checkOut: '2025-01-02', propertyId: 'p' };
  const summary = summarizeReservations(['confirmed', 'cancelled', 'no_show', 'pending'].map(status => ({ ...row, status })), '2026-09-13');
  assert.equal(summary.bookingCount, 1); assert.equal(summary.pastReservations, 1); assert.equal(summary.completedStays, 0);
});
