import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { invitationCandidate, invitationSyncConfig, planInvitationInfo, syncBeds24Invitations } from '../lib/beds24-invitations';
import { sealInvitation } from '../lib/guest-invitation-token';
import { createGuestLinkStore } from '../lib/guest-link-store';
import { resolveInvitation } from '../lib/guest-invitation-access';
import { db, resetDb, prisma, prismaOverrides, calls } from './stubs/prisma';
import { installGuestLinkRegistry } from './helpers/guest-link-registry';
import { installBeds24Mock, json, fetchLog, resetFetch } from './helpers/beds24-mock';

const event = { id: '11111111-1111-4111-8111-111111111111', propertyId: '22222222-2222-4222-8222-222222222222',
  startDate: '2099-10-01', endDate: '2099-10-03', title: 'Test Guest' };
const now = Date.parse('2099-09-01T00:00:00Z');
const config = { origin: 'https://voidanchae.com', since: Date.parse('2099-01-01T00:00:00Z') };
const booking = { id: 123, propertyId: 456, status: 'confirmed', firstName: 'Test', lastName: 'Guest',
  arrival: event.startDate, departure: event.endDate, bookingTime: '2099-08-01T00:00:00Z', lang: 'ko', infoItems: [] };
let registry: ReturnType<typeof installGuestLinkRegistry>;
beforeEach(() => { resetDb(); resetFetch(); registry = installGuestLinkRegistry(); delete process.env.BEDS24_INVITATIONS_ENABLED; delete process.env.BEDS24_INVITATIONS_FROM; });
afterEach(async () => { await registry.close(); });

test('rollout excludes old, cancelled, blocked and nameless bookings', () => {
  assert.throws(() => invitationSyncConfig(), /BEDS24_INVITATIONS_CONFIG_INVALID/);
  assert.equal(invitationCandidate(booking, config, now), true);
  for (const status of ['cancelled', 'request', 'black', 'noshow']) assert.equal(invitationCandidate({ ...booking, status }, config, now), false);
  assert.equal(invitationCandidate({ ...booking, bookingTime: '2098-01-01T00:00:00Z' }, config, now), false);
  assert.equal(invitationCandidate({ ...booking, firstName: '', lastName: '' }, config, now), false);
});

test('planning issues no token; a registered existing link is reused', async () => {
  const plan = (await planInvitationInfo(booking, event, config, now))!;
  assert.equal(plan.language, 'ko');
  assert.equal(plan.reference.id, event.id);
  assert.equal(calls.includes('guestLink.insert'), false);
  const token = await createGuestLinkStore(prisma).issueInvitation(plan.reference);
  const text = `${config.origin}/guest/welcome/${token}?lang=ko`;
  assert.equal((await resolveInvitation(token, now))?.id, event.id);
  assert.equal(await planInvitationInfo({ ...booking, infoItems: [{ code: 'VOID_INVITATION', text, id: 99 }] }, event, config, now), null);
  const replace = (await planInvitationInfo({ ...booking, infoItems: [{ id: 99, code: 'VOID_INVITATION', text: 'invalid' }, { id: 100, code: 'OTHER', text: 'leave alone' }] }, event, config, now))!;
  assert.equal(replace.infoItemId, 99);
  assert.equal(await planInvitationInfo(booking, { ...event, startDate: '2099-09-30' }, config, now), null);
  assert.equal(await planInvitationInfo(booking, { ...event, title: 'Other Guest' }, config, now), null);
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
  const published = fetchLog.find(r => r.method === 'POST')!.body[0].infoItems[0];
  const url = new URL(published.text);
  assert.ok(url.href.length <= 60);
  assert.match(url.pathname, /^\/i\/i2_[A-Za-z0-9_-]{22}$/);
  assert.equal(url.searchParams.get('lang'), 'ko');
  assert.equal((await resolveInvitation(url.pathname.split('/').at(-1)!, now))?.id, event.id);
  assert.equal(calls.filter(call => call === 'guestLink.insert').length, 1);
  assert.ok(calls.findIndex(call => call.startsWith('GET /bookings?')) < calls.indexOf('guestLink.insert'));
  assert.ok(calls.indexOf('guestLink.insert') < calls.findIndex(call => call === 'POST /bookings'));
});

test('fresh cancellation suppresses publishing, failed POST is reported without immediate retry', async () => {
  enable();
  installBeds24Mock({ onGetById: () => json({ success: true, data: [{ ...booking, status: 'cancelled' }] }) });
  assert.deepEqual(await syncBeds24Invitations(event.propertyId, '456', [booking]), { published: 0, failed: 0 });
  assert.equal(fetchLog.filter(r => r.method === 'POST').length, 0);
  assert.equal(calls.includes('guestLink.insert'), false);
  resetFetch();
  installBeds24Mock({ onGetById: () => json({ success: true, data: [booking] }), onCreate: () => json([{ success: false }]) });
  assert.deepEqual(await syncBeds24Invitations(event.propertyId, '456', [booking]), { published: 0, failed: 1 });
  assert.equal(fetchLog.filter(r => r.method === 'POST').length, 1);
});

test('publisher configuration and issued links survive missing or rotated JWT_SECRET', async () => {
  enable();
  const previous = process.env.JWT_SECRET;
  try {
    delete process.env.JWT_SECRET;
    assert.deepEqual(invitationSyncConfig(), config);
    installBeds24Mock({ onGetById: () => json({ success: true, data: [booking] }) });
    assert.deepEqual(await syncBeds24Invitations(event.propertyId, '456', [booking]), { published: 1, failed: 0 });
    const item = fetchLog.find(row => row.method === 'POST')!.body[0].infoItems[0];
    process.env.JWT_SECRET = 'rotated-session-key';
    resetFetch();
    assert.deepEqual(await syncBeds24Invitations(event.propertyId, '456', [{ ...booking, infoItems: [{ ...item, id: 99 }] }]), { published: 0, failed: 0 });
    assert.equal(fetchLog.length, 0);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});

test('fresh remote link prevents duplicate publishing and token issuance', async () => {
  enable();
  const plan = (await planInvitationInfo(booking, event, config, now))!;
  const token = await createGuestLinkStore(prisma).issueInvitation(plan.reference);
  const item = { id: 99, code: 'VOID_INVITATION', text: `${config.origin}/guest/welcome/${token}?lang=ko` };
  calls.length = 0;
  installBeds24Mock({ onGetById: () => json({ success: true, data: [{ ...booking, infoItems: [item] }] }) });
  assert.deepEqual(await syncBeds24Invitations(event.propertyId, '456', [booking]), { published: 0, failed: 0 });
  assert.equal(fetchLog.filter(row => row.method === 'POST').length, 0);
  assert.equal(calls.includes('guestLink.insert'), false);
});

test('registry read failure fails publishing without replacing the remote invitation', async () => {
  enable();
  const plan = (await planInvitationInfo(booking, event, config, now))!;
  const token = await createGuestLinkStore(prisma).issueInvitation(plan.reference);
  const current = { ...booking, infoItems: [{ id: 99, code: 'VOID_INVITATION', text: `${config.origin}/guest/welcome/${token}` }] };
  prismaOverrides.$queryRaw = async () => { throw new Error('registry unavailable'); };
  await assert.rejects(planInvitationInfo(current, event, config, now), /registry unavailable/);
  assert.deepEqual(await syncBeds24Invitations(event.propertyId, '456', [current]), { published: 0, failed: 1 });
  assert.equal(fetchLog.length, 0);
});

test('registry write failure after the fresh read prevents publishing', async () => {
  enable();
  prismaOverrides.$queryRaw = async () => { throw new Error('registry unavailable'); };
  installBeds24Mock({ onGetById: () => json({ success: true, data: [booking] }) });
  assert.deepEqual(await syncBeds24Invitations(event.propertyId, '456', [booking]), { published: 0, failed: 1 });
  assert.equal(fetchLog.filter(row => row.method === 'POST').length, 0);
});

test('a legacy remote invitation is registered and remains unchanged after key rotation', async () => {
  enable();
  const previous = process.env.JWT_SECRET;
  const plan = (await planInvitationInfo(booking, event, config, now))!;
  const token = sealInvitation(plan.reference, previous!);
  const current = { ...booking, infoItems: [{ id: 99, code: 'VOID_INVITATION', text: `${config.origin}/guest/welcome/${token}?lang=ko` }] };
  assert.deepEqual(await syncBeds24Invitations(event.propertyId, '456', [current]), { published: 0, failed: 0 });
  assert.equal(calls.filter(call => call === 'guestLink.insert').length, 1);
  try {
    process.env.JWT_SECRET = 'rotated-session-key';
    assert.deepEqual(await syncBeds24Invitations(event.propertyId, '456', [current]), { published: 0, failed: 0 });
    assert.equal(fetchLog.length, 0);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});
