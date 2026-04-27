import { NextRequest, NextResponse } from 'next/server';
import { beds24Get, getBeds24Token, BEDS24_BASE_URL } from '@/lib/beds24';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

/**
 * GET /api/beds24/messages?bookingId=123
 *   → Fetch messages for a specific Beds24 booking
 *
 * POST /api/beds24/messages (body: { propertyIds: string[] })
 *   → Sync all Beds24 messages for given properties into DB
 */

interface Beds24Message {
  id?: number;
  bookingId: number;
  message: string;
  source?: string;
  time?: string;
  read?: boolean;
  from?: string;
  type?: string;
  datetime?: string;
}

// GET: fetch messages for a single booking from Beds24
export async function GET(req: NextRequest) {
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const bookingId = req.nextUrl.searchParams.get('bookingId');
  if (!bookingId) {
    return NextResponse.json({ error: 'bookingId is required' }, { status: 400 });
  }

  try {
    const data = await beds24Get('/bookings/messages', { bookingId });
    const messages = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : []);
    return NextResponse.json({ messages });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Beds24 messages fetch error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function authorize(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  const header = req.headers.get('x-cron-secret');
  if (header && cronSecret && header === cronSecret) return true;
  const session = await verifySession(req);
  return !!session;
}

// POST: sync Beds24 messages into DB for all bookings of given properties
// Body: { propertyIds?: string[] } — if omitted, defaults to all properties with a Beds24 id
export async function POST(req: NextRequest) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({})) as { propertyIds?: string[] };
    let propertyIds = body.propertyIds;
    if (!propertyIds?.length) {
      const all = await prisma.property.findMany({
        where: { beds24PropId: { not: null } },
        select: { id: true },
      });
      propertyIds = all.map(p => p.id);
    }
    if (!propertyIds.length) {
      return NextResponse.json({ synced: 0, message: 'No Beds24-linked properties' });
    }

    // 1. Find all events from Beds24
    const events = await prisma.event.findMany({
      where: { propertyId: { in: propertyIds }, type: 'reservation' },
      select: { id: true, propertyId: true, title: true, originalUid: true },
    });

    const eventsByBeds24Id = new Map<string, { eventId: string; propertyId: string; title: string }>();
    for (const e of events) {
      if (e.originalUid) {
        eventsByBeds24Id.set(e.originalUid, {
          eventId: e.id,
          propertyId: e.propertyId,
          title: e.title || 'Guest',
        });
      }
    }

    if (eventsByBeds24Id.size === 0) {
      return NextResponse.json({ synced: 0, message: 'No Beds24 events found' });
    }

    // 2. Fetch messages from Beds24 in parallel batches
    let totalSynced = 0;
    const beds24BookingIds = Array.from(eventsByBeds24Id.keys());
    const token = await getBeds24Token();
    const BATCH_SIZE = 10;

    for (let i = 0; i < beds24BookingIds.length; i += BATCH_SIZE) {
      const batch = beds24BookingIds.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (beds24Id) => {
          const res = await fetch(`${BEDS24_BASE_URL}/bookings/messages?bookingId=${beds24Id}`, {
            headers: { token },
          });
          if (!res.ok) return { beds24Id, messages: [] as Beds24Message[] };
          const raw = await res.json();
          const messages: Beds24Message[] = Array.isArray(raw) ? raw : (raw?.data && Array.isArray(raw.data) ? raw.data : []);
          return { beds24Id, messages };
        })
      );

      const bookingsWithMessages = results
        .filter((r): r is PromiseFulfilledResult<{ beds24Id: string; messages: Beds24Message[] }> =>
          r.status === 'fulfilled' && r.value.messages.length > 0)
        .map(r => r.value);

      if (bookingsWithMessages.length === 0) continue;

      // Load existing messages for dedup. Pull all messages on these events
      // (not just source=beds24) so locally-saved host sends can be matched
      // against their Beds24 echo and merged instead of duplicated.
      const eventIds = bookingsWithMessages.map(b => eventsByBeds24Id.get(b.beds24Id)!.eventId);
      const existingMessages = await prisma.message.findMany({
        where: { eventId: { in: eventIds } },
        select: {
          id: true,
          eventId: true,
          createdAt: true,
          text: true,
          sender: true,
          source: true,
          beds24MessageId: true,
        },
      });

      const knownBeds24Ids = new Set<string>();
      const localHostByEvent = new Map<string, Array<{ id: string; text: string; createdAt: Date }>>();
      const fallbackKeysByEvent = new Map<string, Set<string>>();

      const fallbackKey = (text: string, createdAt: Date) =>
        `${createdAt.getTime()}|${text}`;

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
        eventId: string;
        propertyId: string;
        guestName: string;
        text: string;
        sender: string;
        createdAt: Date;
        read: boolean;
        source: string;
        beds24BookingId: string;
        beds24MessageId: string | null;
        beds24MessageType: string;
      };
      const newMessages: NewMsg[] = [];
      // Local host rows promoted to a Beds24 echo (id stamped on existing row)
      const merges: Array<{ id: string; beds24MessageId: string; beds24BookingId: string; beds24MessageType: string }> = [];
      // Track Beds24 ids seen in this batch to avoid intra-batch duplicates
      const seenIds = new Set<string>();
      // Track fallback keys we are about to insert in this batch
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

          // 2. Host echo merge: a local-only host row with same text and
          // a timestamp within ±5 minutes is the same message — stamp it.
          if (sender === 'host') {
            const candidates = localHostByEvent.get(eventId) || [];
            const idx = candidates.findIndex(c =>
              c.text === text && Math.abs(c.createdAt.getTime() - createdAt.getTime()) <= 5 * 60 * 1000
            );
            if (idx !== -1) {
              const matched = candidates[idx];
              candidates.splice(idx, 1);
              if (beds24MessageId) {
                merges.push({ id: matched.id, beds24MessageId, beds24BookingId: beds24Id, beds24MessageType });
              }
              continue;
            }
          }

          // 3. Fallback dedup for messages without a Beds24 id
          if (!beds24MessageId) {
            const key = fallbackKey(text, createdAt);
            const existing = fallbackKeysByEvent.get(eventId);
            if (existing?.has(key) || seenFallback.has(`${eventId}|${key}`)) continue;
            seenFallback.add(`${eventId}|${key}`);
          }

          newMessages.push({
            eventId,
            propertyId: eventInfo.propertyId,
            guestName: eventInfo.title.replace(/ 예약$/, ''),
            text,
            sender,
            createdAt,
            read: sender === 'host',
            source: 'beds24',
            beds24BookingId: beds24Id,
            beds24MessageId,
            beds24MessageType,
          });
          totalSynced++;
        }
      }

      if (merges.length > 0) {
        await Promise.all(merges.map(m =>
          prisma.message.update({
            where: { id: m.id },
            data: {
              source: 'beds24',
              beds24MessageId: m.beds24MessageId,
              beds24BookingId: m.beds24BookingId,
              beds24MessageType: m.beds24MessageType,
              deliveryStatus: 'sent',
            },
          })
        ));
      }

      if (newMessages.length > 0) {
        await prisma.message.createMany({ data: newMessages, skipDuplicates: true });
      }
    }

    return NextResponse.json({ synced: totalSynced, bookingsChecked: beds24BookingIds.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Beds24 messages sync error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
