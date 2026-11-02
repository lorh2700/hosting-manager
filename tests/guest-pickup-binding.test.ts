import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { db, resetDb, prisma, prismaOverrides } from './stubs/prisma';
import { installGuestLinkRegistry } from './helpers/guest-link-registry';
import { makeRequest, callRoute } from './helpers/beds24-mock';
import { sealInvitation } from '../lib/guest-invitation-token';
import { POST } from '../app/api/public/guest-services/route';
import { guestStayRequests } from '../lib/guest-stay-store';
import { todayKst, addDaysToDateStr } from '../lib/dates';
import { notifyCalls, resetNotify } from './stubs/notify';

const bookingId = 'f903b7ea-3eb6-47f4-a152-1418a8c0282c';
const reference = { kind: 'booking' as const, id: bookingId, propertyId: 'p1' };
let registry: ReturnType<typeof installGuestLinkRegistry>, sequence = 0;
beforeEach(() => {
  resetDb(); resetNotify();
  db.property = [{ id: 'p1', slug: 'anon', name: '안온재', status: 'active' }, { id: 'p2', slug: 'byulha', name: '별하재', status: 'active' }];
  db.booking = [{ id: bookingId, propertyId: 'p1', name: 'Test Guest', checkIn: todayKst(), checkOut: addDaysToDateStr(todayKst(), 5), status: 'confirmed', guests: 2 }];
  const base = prisma.guestServiceRequest;
  prismaOverrides.guestServiceRequest = { ...base, create: (args: any) => base.create({ ...args, data: { createdAt: new Date(), updatedAt: new Date(), version: 1, ...args.data } }) };
  registry = installGuestLinkRegistry();
});
afterEach(async () => { await registry.close(); });
function payload(invitation = sealInvitation({ ...reference, expires: Date.now() + 3600000 }, process.env.JWT_SECRET!)) {
  return { id: randomUUID(), slug: 'anon', invitation, guestName: 'Requesting traveller', email: 'traveller@example.test', phone: '+44 7700 900000', arrivalDate: addDaysToDateStr(todayKst(), 1), arrivalTime: '16:30', flightNumber: 'KE902', passengers: 2, luggage: 1, message: 'Arrival pickup', language: 'en', consent: true };
}
const submit = (body: unknown) => { const request = makeRequest(body, 'http://localhost/api/public/guest-services'); request.headers.set('x-forwarded-for', `192.0.2.${++sequence}`); return callRoute(POST, request); };

test('verified invitation binds one authoritative pickup and returns its real receipt across concurrent retries', async () => {
  const input = payload();
  const results = await Promise.all([submit(input), submit(input)]);
  assert.ok(results.every(result => [200, 201].includes(result.status)), JSON.stringify(results));
  assert.ok(results.every(result => result.body.id === input.id && result.body.linkedToStay === true));
  assert.equal(db.guestServiceRequest.length, 1);
  assert.equal(db.guestServiceRequest[0].reservationId, bookingId);
  assert.equal(db.guestServiceRequest[0].reservationKind, 'booking');
  assert.equal(db.guestServiceRequest[0].status, 'requested');
  assert.equal((db.guestStayRequest || []).length, 0);
  assert.equal(notifyCalls.sms.length, 0);
  assert.equal((await submit({ ...input, passengers: 3 })).status, 409);
  db.guestServiceRequest[0].status = 'contacted';
  db.guestServiceRequest[0].internalNote = 'private operator note';
  const requests = await guestStayRequests(reference);
  assert.equal(requests[0].id, input.id);
  assert.equal(requests[0].status, 'reviewing');
  assert.equal(requests[0].flightNumber, 'KE902');
  assert.equal(JSON.stringify(requests).includes('private operator note'), false);
  assert.equal(JSON.stringify(requests).includes('traveller@example.test'), false);
  assert.equal(JSON.stringify(requests).includes('+44'), false);
});

test('forged, expired, property-mismatched and cancelled reservation proofs cannot create a pickup', async () => {
  for (const invitation of ['not-a-valid-proof', sealInvitation({ ...reference, expires: Date.now() - 1000 }, process.env.JWT_SECRET!), sealInvitation({ ...reference, propertyId: 'p2', expires: Date.now() + 3600000 }, process.env.JWT_SECRET!)]) {
    assert.equal((await submit(payload(invitation))).status, 403);
  }
  assert.equal((await submit({ ...payload(), slug: 'byulha' })).status, 403);
  db.booking[0].status = 'cancelled';
  assert.equal((await submit(payload())).status, 403);
  assert.equal((db.guestServiceRequest || []).length, 0);
});

test('reads do not join historical receipts, another reservation or another property by name or phone', async () => {
  const input = payload(); await submit(input);
  const own = db.guestServiceRequest[0];
  db.guestServiceRequest.push({ ...own, id: 'historical', reservationKind: null, reservationId: null },
    { ...own, id: 'other-reservation', reservationId: randomUUID() }, { ...own, id: 'other-property', propertyId: 'p2' });
  const rows = await guestStayRequests(reference);
  assert.deepEqual(rows.map(row => row.id), [input.id]);
  assert.equal(db.guestServiceRequest.length, 4);
});

test('additive SQL preserves old receipts and accepts old writers while rejecting half bindings', async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE properties(id TEXT PRIMARY KEY); INSERT INTO properties VALUES ('p1');");
    await pg.exec(await readFile(new URL('../prisma/migrations/20260918000000_guest_service_requests/migration.sql', import.meta.url), 'utf8'));
    const insert = "INSERT INTO guest_service_requests(id,property_id,guest_name,email,phone,arrival_date,arrival_time,flight_number,passengers,luggage,quoted_price,request_hash) VALUES ('old','p1','Test','t@example.test','01000000000','2027-01-01','15:00','KE902',2,1,100000,'hash')";
    await pg.exec(insert);
    await pg.exec(await readFile(new URL('../prisma/migrations/20261101200000_guest_pickup_reservation_binding/migration.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await pg.query('SELECT reservation_kind, reservation_id FROM guest_service_requests')).rows, [{ reservation_kind: null, reservation_id: null }]);
    await pg.exec(insert.replace("'old'", "'old-writer-after-migration'"));
    await assert.rejects(pg.exec("UPDATE guest_service_requests SET reservation_kind='booking' WHERE id='old'"));
    await pg.exec("UPDATE guest_service_requests SET reservation_kind='booking',reservation_id='verified-booking' WHERE id='old'");
    assert.equal((await pg.query<{relrowsecurity:boolean}>("SELECT relrowsecurity FROM pg_class WHERE relname='guest_service_requests'")).rows[0].relrowsecurity, true);
  } finally { await pg.close(); }
});
