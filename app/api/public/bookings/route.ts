import { NextResponse } from 'next/server';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { propertyId, checkIn, checkOut, guests, name, email, phone, message } = body;

    if (!propertyId || !checkIn || !checkOut || !name || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Check for conflicts with existing events and bookings
    const eventsSnap = await getDocs(
      query(collection(db, 'events'), where('propertyId', '==', propertyId))
    );
    const bookingsSnap = await getDocs(
      query(collection(db, 'bookings'), where('propertyId', '==', propertyId), where('status', '==', 'confirmed'))
    );

    const allDates = [
      ...eventsSnap.docs.map(d => ({ start: d.data().start as string, end: d.data().end as string })),
      ...bookingsSnap.docs.map(d => ({ start: d.data().checkIn as string, end: d.data().checkOut as string })),
    ];

    const newStart = new Date(checkIn).getTime();
    const newEnd = new Date(checkOut).getTime();

    const conflict = allDates.find(({ start, end }) => {
      const s = new Date(start.substring(0, 10)).getTime();
      const e = new Date(end.substring(0, 10)).getTime();
      return newStart < e && newEnd > s;
    });

    if (conflict) {
      return NextResponse.json({ error: '선택한 날짜에 이미 예약이 있습니다.' }, { status: 409 });
    }

    const bookingRef = await addDoc(collection(db, 'bookings'), {
      propertyId,
      name,
      email,
      phone: phone || '',
      guests: Number(guests) || 1,
      checkIn,
      checkOut,
      message: message || '',
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, bookingId: bookingRef.id }, { status: 201 });
  } catch (error) {
    console.error('Failed to create booking:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
