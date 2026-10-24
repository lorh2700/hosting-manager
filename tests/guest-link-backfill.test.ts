import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { backfillGuestLinks } from '../lib/guest-link-backfill';
import { createGuestLinkStore, guestLinkHash } from '../lib/guest-link-store';
import { sealInvitation } from '../lib/guest-invitation-token';
import { installGuestLinkRegistry } from './helpers/guest-link-registry';
import { calls, prisma, resetDb } from './stubs/prisma';

const now = Date.parse('2026-10-13T10:00:00+09:00');
const secret = 'backfill-test-only-key';
const property = { id: 'p-backfill', status: 'active', beds24PropId: '1234' };
const event = { id: '30d9b419-d814-4997-a214-00bc276c726d', propertyId: property.id, originalUid: '555', type: 'reservation',
  channelId: 'beds24', source: 'airbnb', startDate: '2026-10-16', endDate: '2026-10-18', title: 'Private Guest' };
const reference = { kind: 'event' as const, id: event.id, propertyId: property.id, expires: Date.parse('2026-11-17T00:00:00+09:00') };
let registry: ReturnType<typeof installGuestLinkRegistry>;
beforeEach(() => { resetDb(); registry = installGuestLinkRegistry(); });
afterEach(async () => { await registry.close(); });
function setup(token = sealInvitation(reference, secret)) {
  const booking: Record<string, unknown> = { id: 555, propertyId: 1234, status: 'confirmed', arrival: event.startDate, departure: event.endDate,
    firstName: 'Private', lastName: 'Guest', infoItems: [{ code: 'VOID_INVITATION', text: `https://voidanchae.com/guest/welcome/${token}?lang=en` }] };
  const reads: Record<string, string>[] = [];
  const options = { db: prisma, secret, now, listProperties: async () => [property], listEvents: async () => [event],
    readBookings: async (params: Record<string, string>) => {
      reads.push(params);
      return { success: true, data: [booking], pages: { nextPageExists: false } };
    } };
  return { token, booking, reads, options };
}
function qrToken() {
  const encoded = Buffer.from(property.id).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(`void-guest-checkout-v1:${encoded}`).digest('base64url')}`;
}

test('dry run verifies invitations and printed QR hashes without issuing or saving links', async () => {
  const { options, reads, token } = setup();
  const report = await backfillGuestLinks(options);
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.complete, true);
  assert.equal(report.invitations.verified, 1);
  assert.equal(report.checkoutQrs.verified, 1);
  assert.equal(calls.filter(call => call === 'guestLink.insert').length, 0);
  assert.deepEqual(reads, [{ propertyId: '1234', departureFrom: '2026-09-13', includeInfoItems: 'true', page: '1' }]);
  assert.equal((await createGuestLinkStore(prisma).invitation(token, now)).found, false);
  const serialized = JSON.stringify(report);
  for (const sensitive of [token, secret, 'Private Guest', 'https://']) assert.equal(serialized.includes(sensitive), false);
});

test('apply registers only verified legacy links and is idempotent without extending expiry', async () => {
  const { options, token } = setup();
  const report = await backfillGuestLinks({ ...options, apply: true });
  assert.equal(report.complete, true);
  assert.equal(report.invitations.registered, 1);
  assert.equal(report.checkoutQrs.registered, 1);
  assert.deepEqual(await createGuestLinkStore(prisma).invitation(token, now), { found: true, reference });
  assert.deepEqual(await createGuestLinkStore(prisma).checkout(qrToken(), now), { found: true, propertyId: property.id });
  const repeat = await backfillGuestLinks({ ...options, apply: true });
  assert.equal(repeat.invitations.alreadyRegistered, 1);
  assert.equal(repeat.checkoutQrs.alreadyRegistered, 1);
  assert.equal(repeat.invitations.registered, 0);
  assert.equal(repeat.checkoutQrs.registered, 0);
});

test('a remote Info Item cannot adopt an undecipherable token or a different reservation', async () => {
  const invalid = setup(sealInvitation(reference, 'lost-signing-key'));
  const report = await backfillGuestLinks({ ...invalid.options, apply: true });
  assert.equal(report.invitations.registered, 0);
  assert.equal(report.invitations.unresolved, 1);
  const mismatch = setup(sealInvitation({ ...reference, id: '865bd296-fd3a-4e53-bd5f-ae493d0e8817' }, secret));
  const other = await backfillGuestLinks({ ...mismatch.options, apply: true });
  assert.equal(other.invitations.registered, 0);
  assert.equal(other.issues.some(issue => issue.code === 'INVITATION_RESERVATION_MISMATCH'), true);
});

test('cancelled or mismatched property, guest, dates and local booking identity cannot be adopted', async () => {
  for (const patch of [{ status: 'cancelled' }, { propertyId: 999 }, { firstName: 'Someone' }, { departure: '2026-11-10' }]) {
    const current = setup();
    Object.assign(current.booking, patch);
    assert.equal((await backfillGuestLinks({ ...current.options, apply: true })).invitations.registered, 0);
  }
  const current = setup();
  assert.equal((await backfillGuestLinks({ ...current.options, apply: true,
    listEvents: async () => [{ ...event, originalUid: 'other-booking' }] })).invitations.registered, 0);
});

test('revoked invitations and printed QR tokens are not reactivated by backfill', async () => {
  const current = setup();
  await backfillGuestLinks({ ...current.options, apply: true });
  await (await registry.sql()).query('UPDATE guest_link_tokens SET revoked_at=now() WHERE token_hash=ANY($1)',
    [[guestLinkHash(current.token), guestLinkHash(qrToken())]]);
  const report = await backfillGuestLinks({ ...current.options, apply: true });
  assert.equal(report.invitations.registered, 0);
  assert.equal(report.checkoutQrs.registered, 0);
  assert.equal(report.invitations.unresolved, 1);
  assert.equal(report.checkoutQrs.unresolved, 1);
  assert.equal((await createGuestLinkStore(prisma).invitation(current.token, now)).reference, null);
});

test('bounded or malformed pagination reports an incomplete scan before invitation registration', async () => {
  const current = setup();
  const report = await backfillGuestLinks({ ...current.options, apply: true, maxPages: 1,
    readBookings: async () => ({ data: [current.booking], pages: { nextPageExists: true } }) });
  assert.equal(report.incompleteProperties, 1);
  assert.equal(report.complete, false);
  assert.equal(report.invitations.registered, 0);
  const malformed = await backfillGuestLinks({ ...current.options, apply: true,
    readBookings: async () => ({ data: [current.booking] }) });
  assert.equal(malformed.incompleteProperties, 1);
});

test('read failures disclose neither provider response text nor the guest URL', async () => {
  const current = setup();
  const report = await backfillGuestLinks({ ...current.options,
    readBookings: async () => { throw new Error(`${current.token} Private Guest`); } });
  assert.equal(report.incompleteProperties, 1);
  assert.equal(JSON.stringify(report).includes(current.token), false);
  assert.equal(JSON.stringify(report).includes('Private Guest'), false);
});

test('already registered invitations remain verifiable without the old signing key', async () => {
  const current = setup();
  await backfillGuestLinks({ ...current.options, apply: true });
  const report = await backfillGuestLinks({ ...current.options, secret: '', apply: true });
  assert.equal(report.invitations.alreadyRegistered, 1);
  assert.equal(report.invitations.unresolved, 0);
  assert.equal(report.checkoutQrs.unresolved, 1);
});

test('known room mappings limit queries and ignore other rooms under the same Beds24 property', async () => {
  const current = setup();
  const roomProperty = { ...property, beds24RoomId: '678' };
  current.booking.roomId = 678;
  const reads: Record<string, string>[] = [];
  const report = await backfillGuestLinks({ ...current.options, apply: true, listProperties: async () => [roomProperty],
    readBookings: async params => {
      reads.push(params);
      return { data: [current.booking, { ...current.booking, id: 556, roomId: 679 }], pages: { nextPageExists: false } };
    } });
  assert.equal(report.complete, true);
  assert.equal(report.invitations.registered, 1);
  assert.equal(reads[0].roomId, '678');
  delete current.booking.roomId;
  const missingRoom = await backfillGuestLinks({ ...current.options, apply: true, listProperties: async () => [roomProperty] });
  assert.equal(missingRoom.invitations.unresolved, 1);
});
