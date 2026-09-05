import { beds24Get, describeBeds24Error } from '@/lib/beds24';
import { prisma } from '@/lib/prisma';
import { withAuth, withErrors, ok, fail, MESSAGES, cronOrSession, visibleScope, requireQuery } from '@/lib/core/http';

/**
 * GET /api/beds24/messages?bookingId=123  → Fetch messages for a specific Beds24 booking
 * POST /api/beds24/messages (body: { propertyIds?: string[], maxAgeDays?: number })
 *   → Sync recent Beds24 messages for given properties into DB (cron or session)
 *
 * 크레딧 주의: Beds24 는 계정당 5분에 100크레딧, 호출 1건 = 1크레딧. 숙소 단위로
 * `propertyId + maxAge` 한 번에 받는다 — 숙소당 1크레딧 (예약마다 조회하던 시절엔 140건+).
 */

interface Beds24Message {
  id?: number;
  bookingId: number;
  propertyId?: number;
  roomId?: number;
  message: string;
  source?: string;
  time?: string;
  read?: boolean;
  from?: string;
  type?: string;
  datetime?: string;
}

export const GET = withAuth('beds24/messages', async (req, { auth }) => {
  const bookingId = requireQuery(req, 'bookingId');

  // 그 Beds24 예약이 볼 수 있는 숙소에 속하는지 확인 (관리자는 전체).
  if (!auth.isAdmin) {
    const owners = await prisma.event.findMany({ where: { channelId: 'beds24', originalUid: bookingId }, select: { propertyId: true } });
    const visible = await visibleScope(auth, owners.map(o => o.propertyId));
    if (owners.length === 0 || !visible || visible.length === 0) throw fail(403, MESSAGES.forbidden);
  }

  try {
    const data = await beds24Get('/bookings/messages', { bookingId });
    const messages = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : []);
    return ok({ messages });
  } catch (err) {
    throw fail(500, describeBeds24Error(err));
  }
});

// 크론은 15분마다 돈다. 3일치를 보면 크론이 몇 번 실패해도 빠짐없이 복구된다.
const DEFAULT_MAX_AGE_DAYS = 3;
const MAX_PAGES = 20;

// 숙소 한 곳의 최근 maxAge 일치 메시지를 페이지 단위로 모두 가져온다 (페이지 1건 = 1크레딧).
async function fetchPropertyMessages(beds24PropId: string, maxAgeDays: number): Promise<Beds24Message[]> {
  const out: Beds24Message[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await beds24Get('/bookings/messages', { propertyId: beds24PropId, maxAge: String(maxAgeDays), page: String(page) }, { timeoutMs: 15_000 });
    const list: Beds24Message[] = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    out.push(...list);
    if (!data?.pages?.nextPageExists || list.length === 0) break;
  }
  return out;
}

export const POST = withErrors('beds24/messages', async (req) => {
  await cronOrSession(req);

  const body = (await req.json().catch(() => ({}))) as { propertyIds?: string[]; maxAgeDays?: number };
  const maxAgeDays = Math.min(90, Math.max(1, Number(body.maxAgeDays) || DEFAULT_MAX_AGE_DAYS));

  const properties = await prisma.property.findMany({
    where: body.propertyIds?.length
      ? { id: { in: body.propertyIds }, beds24PropId: { not: null } }
      : { beds24PropId: { not: null } },
    select: { id: true, name: true, beds24PropId: true },
  });
  if (properties.length === 0) return ok({ synced: 0, message: 'No Beds24-linked properties' });
  const propertyIds = properties.map(p => p.id);

  // 1. Beds24 booking id → local event (메시지를 붙일 대상)
  const events = await prisma.event.findMany({
    where: { propertyId: { in: propertyIds }, channelId: 'beds24', type: 'reservation' },
    select: { id: true, propertyId: true, title: true, originalUid: true },
  });
  const eventsByBeds24Id = new Map<string, { eventId: string; propertyId: string; title: string }>();
  for (const e of events) {
    if (e.originalUid) eventsByBeds24Id.set(e.originalUid, { eventId: e.id, propertyId: e.propertyId, title: e.title || 'Guest' });
  }

  // 2. 숙소 단위로 최근 메시지 조회 — 숙소 하나가 실패해도 나머지는 계속.
  const errors: Array<{ propertyId: string; error: string }> = [];
  const byBooking = new Map<string, Beds24Message[]>();
  for (const p of properties) {
    try {
      for (const m of await fetchPropertyMessages(p.beds24PropId!, maxAgeDays)) {
        const key = String(m.bookingId);
        if (!byBooking.has(key)) byBooking.set(key, []);
        byBooking.get(key)!.push(m);
      }
    } catch (e) {
      const error = describeBeds24Error(e);
      console.error(`[beds24/messages] fetch failed for ${p.name}:`, error);
      errors.push({ propertyId: p.id, error });
    }
  }

  // 로컬에 예약이 없는 booking 의 메시지는 붙일 곳이 없으므로 건너뛴다.
  const bookingsWithMessages = Array.from(byBooking.entries())
    .filter(([beds24Id, messages]) => eventsByBeds24Id.has(beds24Id) && messages.length > 0)
    .map(([beds24Id, messages]) => ({ beds24Id, messages }));

  let totalSynced = 0;

  if (bookingsWithMessages.length > 0) {
    // Load existing messages for dedup — all messages on these events so locally-saved
    // host sends can be matched against their Beds24 echo and merged instead of duplicated.
    const eventIds = bookingsWithMessages.map(b => eventsByBeds24Id.get(b.beds24Id)!.eventId);
    const existingMessages = await prisma.message.findMany({
      where: { eventId: { in: eventIds } },
      select: { id: true, eventId: true, createdAt: true, text: true, sender: true, source: true, beds24MessageId: true },
    });

    const knownBeds24Ids = new Set<string>();
    const localHostByEvent = new Map<string, Array<{ id: string; text: string; createdAt: Date }>>();
    const fallbackKeysByEvent = new Map<string, Set<string>>();
    const fallbackKey = (text: string, createdAt: Date) => `${createdAt.getTime()}|${text}`;

    for (const m of existingMessages) {
      if (m.beds24MessageId) knownBeds24Ids.add(m.beds24MessageId);
      if (!m.eventId) continue;
      if (m.sender === 'host' && !m.beds24MessageId) {
        if (!localHostByEvent.has(m.eventId)) localHostByEvent.set(m.eventId, []);
        localHostByEvent.get(m.eventId)!.push({ id: m.id, text: m.text, createdAt: m.createdAt });
      }
      if (m.source === 'beds24') {
        if (!fallbackKeysByEvent.has(m.eventId)) fallbackKeysByEvent.set(m.eventId, new Set());
        fallbackKeysByEvent.get(m.eventId)!.add(fallbackKey(m.text, m.createdAt));
      }
    }

    type NewMsg = {
      eventId: string; propertyId: string; guestName: string; text: string; sender: string; createdAt: Date;
      read: boolean; source: string; beds24BookingId: string; beds24MessageId: string | null; beds24MessageType: string;
    };
    const newMessages: NewMsg[] = [];
    const merges: Array<{ id: string; beds24MessageId: string; beds24BookingId: string; beds24MessageType: string }> = [];
    const seenIds = new Set<string>();
    const seenFallback = new Set<string>();

    for (const { beds24Id, messages } of bookingsWithMessages) {
      const eventInfo = eventsByBeds24Id.get(beds24Id)!;
      const eventId = eventInfo.eventId;

      for (const msg of messages) {
        const text = (msg.message || '').trim();
        if (!text) continue;

        const rawTime = msg.time || msg.datetime;
        const createdAt = rawTime ? new Date(rawTime) : new Date();
        const beds24MessageId = msg.id != null ? String(msg.id) : null;
        const senderType = (msg.source || msg.type || msg.from || '').toLowerCase();
        const sender = senderType.includes('guest') ? 'guest' : 'host';
        const beds24MessageType = msg.source || msg.type || msg.from || 'unknown';

        // 1. Skip if we already know this Beds24 message id
        if (beds24MessageId) {
          if (knownBeds24Ids.has(beds24MessageId) || seenIds.has(beds24MessageId)) continue;
          seenIds.add(beds24MessageId);
        }

        // 2. Host echo merge: a local-only host row with same text within ±5 minutes is the same message.
        if (sender === 'host') {
          const candidates = localHostByEvent.get(eventId) || [];
          const idx = candidates.findIndex(c => c.text === text && Math.abs(c.createdAt.getTime() - createdAt.getTime()) <= 5 * 60 * 1000);
          if (idx !== -1) {
            const matched = candidates[idx];
            candidates.splice(idx, 1);
            if (beds24MessageId) merges.push({ id: matched.id, beds24MessageId, beds24BookingId: beds24Id, beds24MessageType });
            continue;
          }
        }

        // 3. Fallback dedup for messages without a Beds24 id
        if (!beds24MessageId) {
          const key = fallbackKey(text, createdAt);
          if (fallbackKeysByEvent.get(eventId)?.has(key) || seenFallback.has(`${eventId}|${key}`)) continue;
          seenFallback.add(`${eventId}|${key}`);
        }

        newMessages.push({
          eventId, propertyId: eventInfo.propertyId, guestName: eventInfo.title.replace(/ 예약$/, ''),
          text, sender, createdAt, read: sender === 'host', source: 'beds24',
          beds24BookingId: beds24Id, beds24MessageId, beds24MessageType,
        });
        totalSynced++;
      }
    }

    if (merges.length > 0) {
      await Promise.all(merges.map(m => prisma.message.update({
        where: { id: m.id },
        data: { source: 'beds24', beds24MessageId: m.beds24MessageId, beds24BookingId: m.beds24BookingId, beds24MessageType: m.beds24MessageType, deliveryStatus: 'sent' },
      })));
    }
    if (newMessages.length > 0) await prisma.message.createMany({ data: newMessages, skipDuplicates: true });
  }

  return ok({ synced: totalSynced, propertiesChecked: properties.length, bookingsWithMessages: bookingsWithMessages.length, maxAgeDays, errors });
});
