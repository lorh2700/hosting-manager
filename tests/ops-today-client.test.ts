import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTodayConversation, type TodayOverview, type TodayConversation } from '../lib/ops-today-client';
import { createOpsSnapshotCache } from '../lib/ops-loading';

function overview(): TodayOverview {
  return {
    today: '2026-10-02', detailsLoaded: true, cleanersLoaded: false, cleaners: [],
    counts: { pendingApplications: null, openIssues: null, pendingSupplies: null },
    properties: [{
      id: 'p1', name: '안온재', readyMessage: '입실 안내', hasWork: true, camera: [],
      cleaning: { id: 'c1', status: 'pending', cleanerId: 'u1', cleanerName: '담당자', supplies: null, notes: null },
      checkoutStatus: null, checkouts: [], checkins: [{
        id: 'e1', kind: 'event', propertyId: 'p1', guestName: '게스트', start: '2026-10-02', end: '2026-10-04', nights: 2,
        guests: 2, pets: 1, channel: 'Booking.com', hasChat: true, readyDelivery: 'sent', unread: 2,
        messages: [], messagesAvailable: false, messagesLoaded: false, flags: [],
      }],
    }],
  };
}
const conversation: TodayConversation = {
  today: '2026-10-02', eventId: 'e1', messagesAvailable: true, flags: ['early_checkin'],
  messages: [{ id: 'm1', sender: 'guest', text: '조금 일찍 입실 가능한가요?', at: '2026-10-02T00:00:00Z' }],
};

test('lazy guest reads enrich only conversation details and keep the authoritative operational state', () => {
  const original = overview();
  const updated = mergeTodayConversation(original, conversation);
  const reservation = updated.properties[0].checkins[0];
  assert.equal(reservation.messagesLoaded, true);
  assert.equal(reservation.messagesAvailable, true);
  assert.deepEqual(reservation.messages, conversation.messages);
  assert.deepEqual(reservation.flags, ['early_checkin']);
  assert.equal(reservation.readyDelivery, 'sent');
  assert.equal(reservation.unread, 2);
  assert.equal(reservation.pets, 1);
  assert.equal(updated.properties[0].cleaning, original.properties[0].cleaning);
  assert.equal(updated.cleanersLoaded, false);
  assert.equal(updated.counts, original.counts);
  assert.equal(original.properties[0].checkins[0].messagesLoaded, false);
});

test('late, unrelated, unavailable or non-channel responses cannot patch the current board', () => {
  const original = overview();
  assert.equal(mergeTodayConversation(original, { ...conversation, today: '2026-10-01' }), original);
  assert.equal(mergeTodayConversation(original, { ...conversation, eventId: 'other-guest' }), original);
  assert.equal(mergeTodayConversation(original, { ...conversation, messagesAvailable: false }), original);
  const direct = overview(); direct.properties[0].checkins[0].hasChat = false;
  assert.equal(mergeTodayConversation(direct, conversation), direct);
});

test('same-day display snapshots remain scoped while revalidating and cannot cross KST midnight', () => {
  const cache = createOpsSnapshotCache<TodayOverview>(5 * 60_000);
  const now = Date.parse('2026-10-02T14:58:00Z');
  cache.write('user-1:scope-1', overview(), now);
  assert.ok(cache.read('user-1:scope-1', now + 90_000));
  assert.equal(cache.read('user-2:scope-1', now + 90_000), null);
  assert.equal(cache.read('user-1:scope-2', now + 90_000), null);
  assert.equal(cache.read('user-1:scope-1', Date.parse('2026-10-02T15:00:00Z')), null);
  cache.write('user-1:scope-1', overview(), Date.parse('2026-10-02T10:00:00Z'));
  assert.equal(cache.read('user-1:scope-1', Date.parse('2026-10-02T10:05:00Z')), null);
});
