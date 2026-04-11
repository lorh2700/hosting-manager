import { NextRequest, NextResponse } from 'next/server';
import { beds24Get, getBeds24Token, BEDS24_BASE_URL } from '@/lib/beds24';
import { getAdminDb, verifyAuthToken } from '@/lib/firebase-admin';

/**
 * GET /api/beds24/messages?bookingId=123
 *   → Fetch messages for a specific Beds24 booking
 *
 * POST /api/beds24/messages (body: { propertyIds: string[] })
 *   → Sync all Beds24 messages for given properties into Firestore
 */

interface Beds24Message {
  id?: number;
  bookingId: number;
  message: string;
  source?: string;     // 'guest' | 'host'
  time?: string;       // ISO datetime (e.g. '2026-04-11T08:35:06Z')
  read?: boolean;
  // Legacy field names (kept for backwards compatibility)
  from?: string;
  type?: string;
  datetime?: string;
}

// GET: fetch messages for a single booking from Beds24
export async function GET(req: NextRequest) {
  try {
    await verifyAuthToken(req);
  } catch {
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

// POST: sync Beds24 messages into Firestore for all bookings of given properties
export async function POST(req: NextRequest) {
  try {
    await verifyAuthToken(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { propertyIds } = await req.json() as { propertyIds: string[] };
    if (!propertyIds?.length) {
      return NextResponse.json({ error: 'propertyIds required' }, { status: 400 });
    }

    const db = getAdminDb();

    // 1. Find all events from Beds24 (they have numeric IDs as originalUid)
    const eventsByBeds24Id = new Map<string, { eventId: string; propertyId: string; title: string }>();

    for (let i = 0; i < propertyIds.length; i += 10) {
      const chunk = propertyIds.slice(i, i + 10);
      const snap = await db.collection('events')
        .where('propertyId', 'in', chunk)
        .where('type', '==', 'reservation')
        .get();
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.originalUid) {
          eventsByBeds24Id.set(String(data.originalUid), {
            eventId: d.id,
            propertyId: data.propertyId,
            title: data.title || 'Guest',
          });
        }
      });
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

      // Fetch messages for batch in parallel
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

      // Collect all eventIds that have messages to batch the dedupe query
      const bookingsWithMessages = results
        .filter((r): r is PromiseFulfilledResult<{ beds24Id: string; messages: Beds24Message[] }> =>
          r.status === 'fulfilled' && r.value.messages.length > 0)
        .map(r => r.value);

      if (bookingsWithMessages.length === 0) continue;

      // Batch load existing messages for deduplication
      const eventIds = bookingsWithMessages.map(b => eventsByBeds24Id.get(b.beds24Id)!.eventId);
      const existingByEvent = new Map<string, Set<string>>();

      for (let j = 0; j < eventIds.length; j += 10) {
        const chunk = eventIds.slice(j, j + 10);
        const existingSnap = await db.collection('messages')
          .where('eventId', 'in', chunk)
          .where('source', '==', 'beds24')
          .get();
        existingSnap.docs.forEach(d => {
          const data = d.data();
          const key = `${data.createdAt}|${data.text?.substring(0, 50)}`;
          if (!existingByEvent.has(data.eventId)) existingByEvent.set(data.eventId, new Set());
          existingByEvent.get(data.eventId)!.add(key);
        });
      }

      // Write new messages using batched writes
      let writeBatch = db.batch();
      let batchCount = 0;

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

          const ref = db.collection('messages').doc();
          writeBatch.set(ref, {
            eventId: eventInfo.eventId,
            propertyId: eventInfo.propertyId,
            guestName: eventInfo.title.replace(/ 예약$/, ''),
            text: text.trim(),
            sender,
            createdAt,
            read: sender === 'host',
            source: 'beds24',
            beds24BookingId: beds24Id,
            beds24MessageType: msg.source || msg.type || msg.from || 'unknown',
          });
          batchCount++;
          totalSynced++;

          // Firestore batch limit is 500
          if (batchCount >= 490) {
            await writeBatch.commit();
            writeBatch = db.batch();
            batchCount = 0;
          }
        }
      }

      if (batchCount > 0) await writeBatch.commit();
    }

    return NextResponse.json({ synced: totalSynced, bookingsChecked: beds24BookingIds.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Beds24 messages sync error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
