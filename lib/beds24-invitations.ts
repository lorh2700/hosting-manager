import { beds24Get, beds24Post } from '@/lib/beds24';
import { prisma } from '@/lib/prisma';
import { guestGuide } from '@/lib/guest-guide';
import { openInvitation, sealInvitation } from '@/lib/guest-invitation-token';

export const INVITATION_INFO_CODE = 'VOID_INVITATION';
type Booking = Record<string, unknown>;
type InfoItem = { id?: number; code?: string; text?: string };
type Config = { origin: string; since: number; secret: string };
type EventRef = { id: string; propertyId: string; startDate: string; endDate: string; title: string | null };

// A fixed rollout boundary prevents historical bookings
// from suddenly becoming eligible for a new Beds24 Auto Action.
export function invitationSyncConfig(): Config {
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://voidanchae.com');
  const since = Date.parse(process.env.BEDS24_INVITATIONS_FROM || '');
  const secret = process.env.JWT_SECRET || '';
  if (origin.origin !== 'https://voidanchae.com' || !Number.isFinite(since) || !secret) {
    throw new Error('BEDS24_INVITATIONS_CONFIG_INVALID');
  }
  return { origin: origin.origin, since, secret };
}

export function invitationCandidate(b: Booking, config: Config, now = Date.now()) {
  const bookedAt = Date.parse(String(b.bookingTime || ''));
  const departure = Date.parse(`${String(b.departure || '').slice(0, 10)}T00:00:00+09:00`);
  return ['confirmed', 'new'].includes(String(b.status).toLowerCase()) &&
    Number.isSafeInteger(Number(b.id)) && Number(b.id) > 0 &&
    Number.isFinite(bookedAt) && bookedAt >= config.since &&
    Number.isFinite(departure) && departure >= now &&
    Boolean([b.firstName, b.lastName].filter(v => typeof v === 'string').join(' ').trim());
}

export function planInvitationInfo(b: Booking, event: EventRef, config: Config, now = Date.now()) {
  if (!invitationCandidate(b, config, now)) return null;
  // Only publish a link after local guest-facing data matches the remote stay.
  if (event.startDate !== String(b.arrival).slice(0, 10) || event.endDate !== String(b.departure).slice(0, 10) ||
      event.title !== [b.firstName, b.lastName].filter(Boolean).join(' ')) return null;
  if (!Array.isArray(b.infoItems)) throw new Error('BEDS24_INVITATION_INFO_ITEMS_MISSING');
  const items = (b.infoItems as InfoItem[]).filter(i => i.code === INVITATION_INFO_CODE);
  const existing = items.at(-1);
  const expires = Date.parse(`${event.endDate}T00:00:00+09:00`) + 30 * 86400000;
  if (existing?.text) {
    try {
      const url = new URL(existing.text);
      const token = url.pathname.match(/^\/guest\/welcome\/([A-Za-z0-9_-]+)$/)?.[1];
      const ref = token && openInvitation(token, config.secret, now);
      if (url.origin === config.origin && ref && ref.kind === 'event' && ref.id === event.id &&
          ref.propertyId === event.propertyId && ref.expires >= expires) return null;
    } catch { /* Replace malformed or expired invitation fields only. */ }
  }
  if (existing && !existing.id) throw new Error('BEDS24_INVITATION_INFO_ID_MISSING');
  const token = sealInvitation({ kind: 'event', id: event.id, propertyId: event.propertyId, expires }, config.secret);
  const language = String(b.lang || b.language || '').slice(0, 2).toLowerCase();
  const lang = ['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en';
  return { id: Number(b.id), infoItems: [{ ...(existing ? { id: existing.id } : {}),
    code: INVITATION_INFO_CODE, text: `${config.origin}/guest/welcome/${token}?lang=${lang}` }] };
}

export async function syncBeds24Invitations(propertyId: string, beds24PropId: string, bookings: Booking[]) {
  const config = invitationSyncConfig();
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { slug: true } });
  if (!property || !guestGuide(property.slug || '')) return { published: 0, failed: 0 };
  const events = await prisma.event.findMany({ where: { propertyId, channelId: 'beds24', type: 'reservation' },
    select: { id: true, propertyId: true, originalUid: true, startDate: true, endDate: true, title: true } });
  const byUid = new Map(events.map(e => [e.originalUid, e]));
  let published = 0, failed = 0, attempts = 0;
  for (const b of bookings) {
    const event = byUid.get(String(b.id));
    if (!event || !invitationCandidate(b, config)) continue;
    try {
      if (!planInvitationInfo(b, event, config)) continue;
      if (++attempts > 10) break; // Bound extra API work per property/sync.
      const fresh = await beds24Get('/bookings', { id: String(b.id), includeInfoItems: 'true' }, { timeoutMs: 10_000 });
      if (fresh?.success === false || !Array.isArray(fresh?.data)) throw new Error('BEDS24_INVITATION_READ_FAILED');
      const current = fresh.data.find((row: Booking) => String(row.id) === String(b.id) && String(row.propertyId) === beds24PropId);
      if (!current) continue;
      const update = planInvitationInfo(current, event, config);
      if (!update) continue;
      // No blind POST retry: the next sync re-reads Info Items after an ambiguous response.
      const result = await beds24Post('/bookings', [update], { timeoutMs: 10_000 });
      if (!Array.isArray(result) || result[0]?.success !== true) throw new Error('BEDS24_INVITATION_WRITE_FAILED');
      published++;
    } catch {
      failed++;
      // Never log guest names, bearer links, or the remote API response body.
      console.error('[beds24-invitations] link publish failed', { propertyId, bookingId: b.id });
    }
  }
  return { published, failed };
}
