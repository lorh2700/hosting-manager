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

// POST: sync Beds24 messages into DB for all bookings of given properties
export async function POST(req: NextRequest) {
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { propertyIds } = await req.json() as { propertyIds: string[] };
    if (!propertyIds?.length) {
      return NextResponse.json({ error: 'propertyIds required' }, { status: 400 });
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

      // Load existing messages for dedup
      const eventIds = bookingsWithMessages.map(b => eventsByBeds24Id.get(b.beds24Id)!.eventId);
      const existingMessages = await prisma.message.findMany({
        where: { eventId: { in: eventIds }, source: 'beds24' },
        select: { eventId: true, createdAt: true, text: true },
      });

      const existingByEvent = new Map<string, Set<string>>();
      for (const m of existingMessages) {
        const key = `${m.createdAt.toISOString()}|${m.text.substring(0, 50)}`;
        if (!existingByEvent.has(m.eventId!)) existingByEvent.set(m.eventId!, new Set());
        existingByEvent.get(m.eventId!)!.add(key);
      }

      // Write new messages
      const newMessages: Array<{
        eventId: string;
        propertyId: string;
        guestName: string;
        text: string;
        sender: string;
        createdAt: Date;
        read: boolean;
        source: string;
        beds24BookingId: string;
        beds24MessageType: string;
      }> = [];

      for (const { beds24Id, messages } of bookingsWithMessages) {
        const eventInfo = eventsByBeds24Id.get(beds24Id)!;
        const existingKeys = existingByEvent.get(eventInfo.eventId) || new Set();

        for (const msg of messages) {
          const createdAt = msg.time || msg.datetime || new Date().toISOString();
          const text = msg.message || '';
          const dedupeKey = `${createdAt}|${text.substring(0, 50)}`;

          if (existingKeys.has(dedupeKey) || !text.trim()) continue;

          const senderType = (msg.source || msg.type || msg.from || '').toLowerCase();
          const sender = senderType.includes('guest') ? 'guest' : 'host';

          newMessages.push({
            eventId: eventInfo.eventId,
            propertyId: eventInfo.propertyId,
            guestName: eventInfo.title.replace(/ 예약$/, ''),
            text: text.trim(),
            sender,
            createdAt: new Date(createdAt),
            read: sender === 'host',
            source: 'beds24',
            beds24BookingId: beds24Id,
            beds24MessageType: msg.source || msg.type || msg.from || 'unknown',
          });
          totalSynced++;
        }
      }

      if (newMessages.length > 0) {
        await prisma.message.createMany({ data: newMessages });
      }
    }

    return NextResponse.json({ synced: totalSynced, bookingsChecked: beds24BookingIds.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Beds24 messages sync error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
