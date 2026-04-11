import { NextRequest, NextResponse } from 'next/server';
import { beds24Post } from '@/lib/beds24';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

/**
 * POST /api/beds24/messages/send
 * Send a message to a guest via Beds24, and save a copy to DB.
 * For direct bookings (no Beds24 ID), saves as local memo only.
 */
export async function POST(req: NextRequest) {
  const session = await verifySession(req);
  if (!session) {
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

    // Look up the event to find Beds24 booking ID
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    let beds24BookingId: string | null = null;
    let guestName = '게스트';

    if (event) {
      beds24BookingId = event.originalUid || null;
      guestName = (event.title || '게스트').replace(/ 예약$/, '');
    } else {
      const booking = await prisma.booking.findUnique({ where: { id: eventId } });
      if (booking) {
        guestName = booking.name || '게스트';
      }
    }

    let deliveryStatus: 'sent' | 'failed' | 'local_only' = 'local_only';

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

    const message = await prisma.message.create({
      data: {
        eventId,
        propertyId,
        guestName,
        text: text.trim(),
        sender: 'host',
        read: true,
        type: beds24BookingId ? 'message' : 'memo',
        deliveryStatus,
      },
    });

    return NextResponse.json({
      id: message.id,
      deliveryStatus,
      isBeds24: !!beds24BookingId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Message send error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
