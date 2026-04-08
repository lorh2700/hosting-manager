import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const db = getAdminDb();
    const propSnap = await db.collection('properties').doc(id).get();
    if (!propSnap.exists) {
      return new NextResponse('Property not found', { status: 404 });
    }

    const data = propSnap.data()!;

    // Fetch synced channel events for this property
    const eventsSnap = await db.collection('events').where('propertyId', '==', id).get();
    const channelDates = eventsSnap.docs.map(d => ({
      start: d.data().start as string,
      end: d.data().end as string,
      type: d.data().type as string,
    }));

    // Fetch confirmed direct bookings
    const bookingsSnap = await db.collection('bookings')
      .where('propertyId', '==', id)
      .where('status', '==', 'confirmed')
      .get();
    const bookingDates = bookingsSnap.docs.map(d => ({
      start: d.data().checkIn as string,
      end: d.data().checkOut as string,
      type: 'reservation',
    }));

    return NextResponse.json({
      id: propSnap.id,
      name: data.name,
      timezone: data.timezone,
      checkInTime: data.checkInTime ?? null,
      checkOutTime: data.checkOutTime ?? null,
      permit: data.permit ?? null,
      bookedDates: [...channelDates, ...bookingDates],
    });
  } catch (error) {
    console.error('Failed to fetch property:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
