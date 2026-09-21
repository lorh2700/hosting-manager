import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { invitationCandidate, invitationSyncConfig, planInvitationInfo, syncBeds24Invitations } from '../lib/beds24-invitations';
import { openInvitation } from '../lib/guest-invitation-token';
import { db, resetDb } from './stubs/prisma';
import { installBeds24Mock, json, fetchLog, resetFetch } from './helpers/beds24-mock';

const event = { id: '11111111-1111-4111-8111-111111111111', propertyId: '22222222-2222-4222-8222-222222222222',
  startDate: '2099-10-01', endDate: '2099-10-03', title: 'Test Guest' };
const now = Date.parse('2099-09-01T00:00:00Z');
const config = { origin: 'https://voidanchae.com', since: Date.parse('2099-01-01T00:00:00Z'), secret: 'test-secret' };
const booking = { id: 123, propertyId: 456, status: 'confirmed', firstName: 'Test', lastName: 'Guest',
  arrival: event.startDate, departure: event.endDate, bookingTime: '2099-08-01T00:00:00Z', lang: 'ko', infoItems: [] };
beforeEach(() => { resetDb(); resetFetch(); delete process.env.BEDS24_INVITATIONS_ENABLED; delete process.env.BEDS24_INVITATIONS_FROM; });

test('rollout excludes old, cancelled, blocked and nameless bookings', () => {
  assert.throws(() => invitationSyncConfig(), /BEDS24_INVITATIONS_CONFIG_INVALID/);
  assert.equal(invitationCandidate(booking, config, now), true);
  for (const status of ['cancelled', 'request', 'black', 'noshow']) assert.equal(invitationCandidate({ ...booking, status }, config, now), false);
  assert.equal(invitationCandidate({ ...booking, bookingTime: '2098-01-01T00:00:00Z' }, config, now), false);
  assert.equal(invitationCandidate({ ...booking, firstName: '', lastName: '' }, config, now), false);
});

test('link resolves to this reservation; repeat sync reuses existing info item', () => {
  const update = planInvitationInfo(booking, event, config, now)!;
  const url = new URL(update.infoItems[0].text);
  assert.equal(url.searchParams.get('lang'), 'ko');
  assert.equal(openInvitation(url.pathname.split('/').at(-1)!, config.secret, now)?.id, event.id);
  assert.equal(planInvitationInfo({ ...booking, infoItems: [{ ...update.infoItems[0], id: 99 }] }, event, config, now), null);
  const replace = planInvitationInfo({ ...booking, infoItems: [{ id: 99, code: 'VOID_INVITATION', text: 'invalid' }, { id: 100, code: 'OTHER', text: 'leave alone' }] }, event, config, now)!;
  assert.equal(replace.infoItems.length, 1);
  assert.equal(replace.infoItems[0].id, 99);
  assert.equal(planInvitationInfo(booking, { ...event, startDate: '2099-09-30' }, config, now), null);
});

function enable() {
  process.env.BEDS24_INVITATIONS_FROM = '2099-01-01T00:00:00Z';
  db.property = [{ id: event.propertyId, slug: 'byulha' }];
  db.event = [{ ...event, channelId: 'beds24', type: 'reservation', originalUid: '123' }];
}

test('publishes only booking Info Items and does not send messages', async () => {
  enable();
  // Legacy deployment flags must no longer disable invitation publishing.
  process.env.BEDS24_INVITATIONS_ENABLED = 'false';
  installBeds24Mock({ onGetById: () => json({ success: true, data: [booking] }), onCreate: body => {
    assert.deepEqual(Object.keys(body[0]).sort(), ['id', 'infoItems']);
    return json([{ success: true }]);
  } });
  assert.deepEqual(await syncBeds24Invitations(event.propertyId, '456', [booking]), { published: 1, failed: 0 });
  assert.equal(fetchLog.filter(r => r.method === 'POST').length, 1);
  assert.ok(!fetchLog.some(r => r.url.includes('/messages')));
});

test('fresh cancellation suppresses publishing, failed POST is reported without immediate retry', async () => {
  enable();
  installBeds24Mock({ onGetById: () => json({ success: true, data: [{ ...booking, status: 'cancelled' }] }) });
  assert.deepEqual(await syncBeds24Invitations(event.propertyId, '456', [booking]), { published: 0, failed: 0 });
  assert.equal(fetchLog.filter(r => r.method === 'POST').length, 0);
  resetFetch();
  installBeds24Mock({ onGetById: () => json({ success: true, data: [booking] }), onCreate: () => json([{ success: false }]) });
  assert.deepEqual(await syncBeds24Invitations(event.propertyId, '456', [booking]), { published: 0, failed: 1 });
  assert.equal(fetchLog.filter(r => r.method === 'POST').length, 1);
});
