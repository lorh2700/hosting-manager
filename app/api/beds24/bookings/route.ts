import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { beds24Post, beds24Put, BEDS24_REFRESH_TOKEN } from '@/lib/beds24';

export async function POST(req: Request) {
  if (!BEDS24_REFRESH_TOKEN) {
    return NextResponse.json({ error: 'BEDS24_REFRESH_TOKEN is not configured' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { propertyId, beds24PropId, firstName, lastName, email, phone, numAdult, numChild, arrival, departure, notes } = body;

    if (!propertyId || !beds24PropId || !arrival || !departure || !firstName) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }

    const beds24Response = await beds24Post('/bookings', [{
      propertyId: Number(beds24PropId),
      arrival,
      departure,
      firstName: firstName || '',
      lastName: lastName || '',
      email: email || '',
      phone: phone || '',
      numAdult: Number(numAdult) || 1,
      numChild: Number(numChild) || 0,
      status: 'confirmed',
      notes: notes || '',
    }]);

    const created = Array.isArray(beds24Response) ? beds24Response[0] : beds24Response;
    const beds24BookingId = created?.id || created?.bookingId;

    const guestName = [firstName, lastName].filter(Boolean).join(' ');
    const booking = await prisma.booking.create({
      data: {
        propertyId,
        name: guestName,
        email: email || '',
        phone: phone || '',
        guests: (Number(numAdult) || 1) + (Number(numChild) || 0),
        checkIn: arrival,
        checkOut: departure,
        status: 'confirmed',
        message: notes || '',
        source: 'beds24',
      },
    });

    return NextResponse.json({
      success: true,
      bookingId: booking.id,
      beds24BookingId: beds24BookingId || null,
    }, { status: 201 });
  } catch (error) {
    console.error('Beds24 booking creation error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!BEDS24_REFRESH_TOKEN) {
    return NextResponse.json({ error: 'BEDS24_REFRESH_TOKEN is not configured' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { beds24BookingId, bookingId, action } = body;

    if (!bookingId || !action) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }

    if (action === 'cancel') {
      if (beds24BookingId) {
        await beds24Put('/bookings', [{
          id: Number(beds24BookingId),
          status: 'cancelled',
        }]);
      }

      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'cancelled' },
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: '알 수 없는 작업입니다.' }, { status: 400 });
  } catch (error) {
    console.error('Beds24 booking update error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
