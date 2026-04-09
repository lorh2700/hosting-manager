import { NextRequest, NextResponse } from 'next/server';
import { beds24Post } from '@/lib/beds24';
import { getAdminDb, verifyAuthToken } from '@/lib/firebase-admin';

/**
 * POST /api/beds24/messages/send
 * Send a message to a guest via Beds24, and save a copy to Firestore.
 * For direct bookings (no Beds24 ID), saves as local memo only.
 *
 * Body: { eventId: string, propertyId: string, text: string }
 */
export async function POST(req: NextRequest) {
  try {
    await verifyAuthToken(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { eventId, propertyId, text } = await req.json() as {
      eventId: string;
      propertyId: string;
      text: string;
    };

    if (!eventId || !propertyId || !text?.trim()) {
      return NextResponse.json({ error: 'eventId, propertyId, and text are required' }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date().toISOString();

    // Look up the event to find Beds24 booking ID
    const eventDoc = await db.collection('events').doc(eventId).get();
    let beds24BookingId: string | null = null;
    let guestName = '게스트';

    if (eventDoc.exists) {
      const eventData = eventDoc.data()!;
      beds24BookingId = eventData.originalUid ? String(eventData.originalUid) : null;
      guestName = (eventData.title || '게스트').replace(/ 예약$/, '');
    } else {
      // Check bookings collection (direct bookings)
      const bookingDoc = await db.collection('bookings').doc(eventId).get();
      if (bookingDoc.exists) {
        guestName = bookingDoc.data()?.name || '게스트';
      }
    }

    let deliveryStatus: 'sent' | 'failed' | 'local_only' = 'local_only';

    // Send via Beds24 if we have a booking ID
    if (beds24BookingId) {
      try {
        await beds24Post('/bookings/messages', [{
          bookingId: Number(beds24BookingId),
          message: text.trim(),
          type: 'host',
        }]);
        deliveryStatus = 'sent';
      } catch (err) {
        console.error('Beds24 message send failed:', err);
        deliveryStatus = 'failed';
      }
    }

    // Save to Firestore
    const messageData = {
      eventId,
      propertyId,
      guestName,
      text: text.trim(),
      sender: 'host' as const,
      createdAt: now,
      read: true,
      type: beds24BookingId ? 'message' : 'memo',
      deliveryStatus,
    };

    const docRef = await db.collection('messages').add(messageData);

    return NextResponse.json({
      id: docRef.id,
      deliveryStatus,
      isBeds24: !!beds24BookingId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Message send error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
