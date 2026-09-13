import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdentity, decideGuest, saveGuestReservation, reviewGuestReservation, guestHistorySummary } from '../lib/guest-history';
import { db, resetDb } from './stubs/prisma';
beforeEach(resetDb);
const identity = { name: '박도영', phone: '010-1234-5678', email: 'owner@example.com' };
const input = { ...identity, key: 'stay:beds24:123', propertyId: 'stay', checkIn: '2027-02-10', checkOut: '2027-02-11', status: 'confirmed', source: 'direct' };
test('Korean and international phones normalize without guessing other domestic countries; relay and masked identities rejected', () => {
  assert.equal(normalizeIdentity(identity).normalizedPhone, '+821012345678');
  assert.equal(normalizeIdentity({ phone: '+82 (10) 1234-5678' }).normalizedPhone, '+821012345678');
  assert.equal(normalizeIdentity({ phone: '020 1234 5678' }).normalizedPhone, null);
  assert.equal(normalizeIdentity({ email: 'guest@guest.booking.com' }).normalizedEmail, null);
  assert.equal(normalizeIdentity({ phone: '010-****-5678' }).normalizedPhone, null);
});
test('same name alone and conflicting contacts require review', () => {
  const norm = normalizeIdentity(identity);
  assert.equal(decideGuest(norm, [{ id: 'a', ...norm }]).guestId, 'a');
  assert.equal(decideGuest(norm, [{ id: 'a', ...normalizeIdentity({ name: identity.name }) }]).matchStatus, 'review');
  assert.equal(decideGuest(norm, [{ id: 'a', ...norm, normalizedEmail: 'different@example.com' }]).matchStatus, 'review');
  assert.equal(decideGuest(norm, [{ id: 'a', ...norm }, { id: 'b', ...norm }]).matchStatus, 'review');
});
test('repeated sync and direct import use one reservation and one guest; cancellation persists', async () => {
  await saveGuestReservation(input); await saveGuestReservation({ ...input, source: 'beds24' });
  assert.equal(db.guest.length, 1); assert.equal(db.guestReservation.length, 1);
  await saveGuestReservation({ ...input, key: 'other:beds24:456', propertyId: 'other' });
  assert.equal(db.guest.length, 1); assert.equal(db.guestReservation[1].guestId, db.guest[0].id);
  await saveGuestReservation({ ...input, status: 'cancelled' });
  assert.equal(guestHistorySummary(db.guestReservation as never).confirmedReservations, 1);
});
test('manual exclusion survives import and contact changes reopen matching', async () => {
  await saveGuestReservation(input);
  const id = db.guestReservation[0].id;
  await reviewGuestReservation(id, null, 'admin', 'ignore');
  await saveGuestReservation(input);
  assert.equal(db.guestReservation[0].matchStatus, 'ignored');
  await saveGuestReservation({ ...input, email: 'other@example.com' });
  assert.equal(db.guestReservation[0].matchStatus, 'review');
});
test('cancelled, pending and no-shows do not count; a past confirmed date is not proof of a completed stay', () => {
  const rows = ['confirmed', 'cancelled', 'pending', 'no_show'].map((status, i) => ({ key: String(i), status, checkIn: '2020-01-01', checkOut: '2020-01-02' }));
  assert.deepEqual(guestHistorySummary(rows), { confirmedReservations: 1, completedStays: 0, isRebooking: true });
  assert.equal(guestHistorySummary(rows, '0').isRebooking, false);
});

import { GET, PUT } from '../app/api/guests/history/route';
import { actAsAdmin, actAsManager } from './stubs/auth';
import { callRoute, makeRequest } from './helpers/beds24-mock';
test('cross-property customer history and review are administrator-only', async () => {
  actAsManager(['stay']);
  assert.equal((await callRoute(GET, makeRequest())).status, 403);
  assert.equal((await callRoute(PUT, makeRequest({ id: 'any', action: 'new' }))).status, 403);
  actAsAdmin();
  await saveGuestReservation(input);
  const response = await callRoute(GET, makeRequest());
  assert.equal(response.status, 200);
  assert.equal(response.body.rows.length, 1);
});
