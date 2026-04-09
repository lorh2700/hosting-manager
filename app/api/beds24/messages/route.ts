import { NextRequest, NextResponse } from 'next/server';
import { beds24Get } from '@/lib/beds24';
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
  from?: string;       // e.g. 'guest', 'host', 'ota'
  type?: string;       // e.g. 'guest', 'host', 'internalNote', 'system'
  datetime?: string;   // ISO datetime
  status?: string;
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
    return NextResponse.json({ messages: Array.isArray(data) ? data : [] });
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

    // 2. Fetch messages from Beds24 for each booking
    let totalSynced = 0;
    const beds24BookingIds = Array.from(eventsByBeds24Id.keys());

    for (const beds24Id of beds24BookingIds) {
      try {
        const data = await beds24Get('/bookings/messages', { bookingId: beds24Id });
        const messages: Beds24Message[] = Array.isArray(data) ? data : [];

        if (messages.length === 0) continue;

        const eventInfo = eventsByBeds24Id.get(beds24Id)!;

        // 3. Check existing messages to avoid duplicates
        const existingSnap = await db.collection('messages')
          .where('eventId', '==', eventInfo.eventId)
          .where('source', '==', 'beds24')
          .get();
        const existingKeys = new Set(
          existingSnap.docs.map(d => {
            const data = d.data();
            return `${data.createdAt}|${data.text?.substring(0, 50)}`;
          })
        );

        // 4. Write new messages to Firestore
        for (const msg of messages) {
          const createdAt = msg.datetime || new Date().toISOString();
          const text = msg.message || '';
          const dedupeKey = `${createdAt}|${text.substring(0, 50)}`;

          if (existingKeys.has(dedupeKey) || !text.trim()) continue;

          // Determine sender: guest messages vs host/system
          const senderType = (msg.type || msg.from || '').toLowerCase();
          const sender = senderType.includes('guest') ? 'guest' : 'host';

          await db.collection('messages').add({
            eventId: eventInfo.eventId,
            propertyId: eventInfo.propertyId,
            guestName: eventInfo.title.replace(/ 예약$/, ''),
            text: text.trim(),
            sender,
            createdAt,
            read: sender === 'host', // host messages are already read
            source: 'beds24',
            beds24BookingId: beds24Id,
            beds24MessageType: msg.type || msg.from || 'unknown',
          });
          totalSynced++;
        }
      } catch (err) {
        // Skip individual booking errors
        console.warn(`Failed to fetch messages for booking ${beds24Id}:`, err);
      }
    }

    return NextResponse.json({ synced: totalSynced, bookingsChecked: beds24BookingIds.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Beds24 messages sync error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
