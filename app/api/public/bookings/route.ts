import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

const FORMSPREE_ENDPOINT = `https://formspree.io/f/${process.env.FORMSPREE_FORM_ID}`;

export async function POST(req: Request) {
  try {
    const db = getAdminDb();
    const body = await req.json();
    const { propertyId, propertyName, checkIn, checkOut, guests, name, email, phone } = body;

    if (!propertyId || !checkIn || !checkOut || !name || !email || !phone) {
      return NextResponse.json({ error: '필수 정보를 모두 입력해주세요.' }, { status: 400 });
    }

    // Check for conflicts with existing events and bookings
    const eventsSnap = await db.collection('events').where('propertyId', '==', propertyId).get();
    const bookingsSnap = await db.collection('bookings')
      .where('propertyId', '==', propertyId)
      .where('status', '!=', 'cancelled')
      .get();

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

    // Save booking as 'pending'
    const bookingRef = await db.collection('bookings').add({
      propertyId,
      propertyName: propertyName || '',
      name,
      email,
      phone,
      guests: Number(guests) || 1,
      checkIn,
      checkOut,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    // Send email notification via Formspree
    try {
      await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          _subject: `[예약요청] ${propertyName || '숙소'} — ${name}님 (${checkIn} ~ ${checkOut})`,
          숙소: propertyName || '숙소',
          체크인: checkIn,
          체크아웃: checkOut,
          인원: `${Number(guests) || 1}명`,
          이름: name,
          연락처: phone,
          이메일: email,
        }),
      });
    } catch (emailError) {
      console.error('Formspree notification failed:', emailError);
      // Booking is saved, email failure is non-blocking
    }

    return NextResponse.json({ success: true, bookingId: bookingRef.id }, { status: 201 });
  } catch (error) {
    console.error('Failed to create booking:', error);
    return NextResponse.json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }
}
