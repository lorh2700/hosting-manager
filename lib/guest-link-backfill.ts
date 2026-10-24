import { createHmac } from 'node:crypto';
import { createGuestLinkStore, type GuestLinkDatabase } from './guest-link-store';
import { openInvitation, type GuestInvitationReference } from './guest-invitation-token';
import { recoverInvitation } from './guest-invitation-recovery';
import { guestInvitationToken } from './guest-invitation-url';

export type BackfillProperty = { id: string; status: string; beds24PropId: string | null; beds24RoomId?: string | null };
export type BackfillEvent = { id: string; propertyId: string; originalUid: string | null; type: string;
  channelId: string | null; source: string | null; startDate: string; endDate: string; title: string | null };
type Booking = Record<string, unknown>;
type Issue = { propertyId: string; bookingId?: string; code: string };
type Counts = { verified: number; registered: number; alreadyRegistered: number; unresolved: number };
export type GuestLinkBackfillReport = { mode: 'dry-run' | 'apply'; properties: number; bookings: number;
  invitations: Counts; checkoutQrs: Counts; incompleteProperties: number; issues: Issue[]; complete: boolean };
type Options = { db: GuestLinkDatabase; secret: string; origin?: string; apply?: boolean; now?: number; maxPages?: number;
  listProperties: () => Promise<BackfillProperty[]>;
  listEvents: (propertyId: string, departureFrom: string) => Promise<BackfillEvent[]>;
  readBookings: (params: Record<string, string>) => Promise<unknown> };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function tokenFromLink(value: unknown, origin: string) {
  return guestInvitationToken(value, origin);
}
function sameBooking(booking: Booking, event: BackfillEvent, property: BackfillProperty, reference: GuestInvitationReference, now: number) {
  const arrival = String(booking.arrival ?? '').slice(0, 10);
  const departure = String(booking.departure ?? '').slice(0, 10);
  const name = [booking.firstName, booking.lastName].filter(Boolean).join(' ');
  const checkout = Date.parse(`${departure}T00:00:00+09:00`);
  return reference.kind === 'event' && reference.id === event.id && reference.propertyId === property.id &&
    event.propertyId === property.id && event.originalUid === String(booking.id) && event.type === 'reservation' &&
    event.channelId === 'beds24' && event.source !== 'maintenance' && String(booking.propertyId) === property.beds24PropId &&
    (!property.beds24RoomId || String(booking.roomId) === property.beds24RoomId) &&
    ['confirmed', 'new'].includes(String(booking.status).toLowerCase()) && !!name.trim() && !name.startsWith('[문의]') &&
    event.title === name && event.startDate === arrival && event.endDate === departure &&
    Number.isFinite(checkout) && checkout + 30 * 86_400_000 > now && reference.expires > now;
}

export async function backfillGuestLinks(options: Options): Promise<GuestLinkBackfillReport> {
  const now = options.now ?? Date.now(), maxPages = options.maxPages ?? 50;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100 || !Number.isFinite(now)) throw new Error('BACKFILL_OPTIONS_INVALID');
  const origin = new URL(options.origin || 'https://voidanchae.com').origin;
  if (origin !== 'https://voidanchae.com') throw new Error('BACKFILL_ORIGIN_INVALID');
  const count = (): Counts => ({ verified: 0, registered: 0, alreadyRegistered: 0, unresolved: 0 });
  const report: GuestLinkBackfillReport = { mode: options.apply ? 'apply' : 'dry-run', properties: 0, bookings: 0,
    invitations: count(), checkoutQrs: count(), incompleteProperties: 0, issues: [], complete: true };
  const issue = (counts: Counts, propertyId: string, code: string, bookingId?: string) => {
    counts.unresolved++;
    report.issues.push({ propertyId, ...(bookingId ? { bookingId } : {}), code });
  };
  const store = createGuestLinkStore(options.db);
  const departureFrom = new Date(now - 30 * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10);
  const properties = (await options.listProperties()).filter(property => property.status === 'active');
  for (const property of properties) {
    report.properties++;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(property.id)) {
      issue(report.checkoutQrs, 'invalid-property-id', 'PROPERTY_ID_INVALID');
      continue;
    }
    if (options.secret) {
      const encoded = Buffer.from(property.id).toString('base64url');
      const token = `${encoded}.${createHmac('sha256', options.secret).update(`void-guest-checkout-v1:${encoded}`).digest('base64url')}`;
      const saved = await store.checkout(token, now);
      if (saved.found && saved.propertyId !== property.id) issue(report.checkoutQrs, property.id, 'REGISTERED_QR_UNAVAILABLE');
      else {
        report.checkoutQrs.verified++;
        if (saved.found) report.checkoutQrs.alreadyRegistered++;
        else if (options.apply) {
          if (await store.registerCheckout(token, property.id)) report.checkoutQrs.registered++;
          else issue(report.checkoutQrs, property.id, 'QR_REGISTRATION_CONFLICT');
        }
      }
    } else issue(report.checkoutQrs, property.id, 'LEGACY_QR_KEY_MISSING');
    if (!property.beds24PropId) continue;
    const bookings: Booking[] = [];
    const seenBookingIds = new Set<string>();
    let complete = false;
    try {
      for (let page = 1; page <= maxPages; page++) {
        const response = await options.readBookings({ propertyId: property.beds24PropId,
          ...(property.beds24RoomId ? { roomId: property.beds24RoomId } : {}), departureFrom,
          includeInfoItems: 'true', page: String(page) });
        if (!record(response) || response.success === false || !Array.isArray(response.data) ||
            !record(response.pages) || typeof response.pages.nextPageExists !== 'boolean') throw new Error('READ_INCOMPLETE');
        if (response.data.length === 0 && response.pages.nextPageExists) throw new Error('READ_INCOMPLETE');
        for (const booking of response.data) {
          if (!record(booking) || !Number.isSafeInteger(Number(booking.id)) || Number(booking.id) <= 0 ||
              seenBookingIds.has(String(booking.id)) || bookings.length >= 10_000) throw new Error('READ_INCOMPLETE');
          seenBookingIds.add(String(booking.id));
          bookings.push(booking);
        }
        if (!response.pages.nextPageExists) { complete = true; break; }
      }
    } catch { complete = false; }
    if (!complete) {
      report.incompleteProperties++;
      report.issues.push({ propertyId: property.id, code: 'BEDS24_SCAN_INCOMPLETE' });
      continue;
    }
    report.bookings += bookings.length;
    const events = await options.listEvents(property.id, departureFrom);
    const byId = new Map(events.map(event => [event.id, event]));
    for (const booking of bookings) {
      if (property.beds24RoomId && booking.roomId != null && String(booking.roomId) !== property.beds24RoomId) continue;
      const bookingId = String(booking.id);
      if (!Array.isArray(booking.infoItems)) {
        issue(report.invitations, property.id, 'BOOKING_INFO_ITEMS_MISSING', bookingId);
        continue;
      }
      const items = booking.infoItems.filter(item => record(item) && item.code === 'VOID_INVITATION');
      const seenTokens = new Set<string>();
      for (const item of items) {
        const token = tokenFromLink(item.text, origin);
        if (!token) { issue(report.invitations, property.id, 'INVITATION_URL_INVALID', bookingId); continue; }
        if (seenTokens.has(token)) continue;
        seenTokens.add(token);
        const saved = await store.invitation(token, now);
        const reference = saved.found ? saved.reference : openInvitation(token, options.secret, now) || recoverInvitation(token, now);
        if (!reference) { issue(report.invitations, property.id, 'INVITATION_UNVERIFIABLE_OR_REVOKED', bookingId); continue; }
        const event = byId.get(reference.id);
        if (!event || !sameBooking(booking, event, property, reference, now)) {
          issue(report.invitations, property.id, 'INVITATION_RESERVATION_MISMATCH', bookingId);
          continue;
        }
        report.invitations.verified++;
        if (saved.found) report.invitations.alreadyRegistered++;
        else if (options.apply) {
          if (await store.registerInvitation(token, reference)) report.invitations.registered++;
          else issue(report.invitations, property.id, 'INVITATION_REGISTRATION_CONFLICT', bookingId);
        }
      }
    }
  }
  report.complete = !report.incompleteProperties && !report.invitations.unresolved && !report.checkoutQrs.unresolved;
  return report;
}
