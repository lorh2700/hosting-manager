import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const FORMSPREE_ENDPOINT = `https://formspree.io/f/${process.env.FORMSPREE_FORM_ID}`;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { propertyId, propertyName, checkIn, checkOut, guests, name, email, phone } = body;

    if (!propertyId || !checkIn || !checkOut || !name || !email || !phone) {
      return NextResponse.json({ error: '필수 정보를 모두 입력해주세요.' }, { status: 400 });
    }

    // Check for conflicts
    const events = await prisma.event.findMany({
      where: { propertyId },
      select: { startDate: true, endDate: true },
    });
    const bookings = await prisma.booking.findMany({
      where: { propertyId, status: { not: 'cancelled' } },
      select: { checkIn: true, checkOut: true },
    });

    const allDates = [
      ...events.map(e => ({ start: e.startDate, end: e.endDate })),
      ...bookings.map(b => ({ start: b.checkIn, end: b.checkOut })),
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

    const booking = await prisma.booking.create({
      data: {
        propertyId,
        name,
        email,
        phone,
        guests: Number(guests) || 1,
        checkIn,
        checkOut,
        status: 'pending',
      },
    });

    // Send email notification
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
    }

    return NextResponse.json({ success: true, bookingId: booking.id }, { status: 201 });
  } catch (error) {
    console.error('Failed to create booking:', error);
    return NextResponse.json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }
}
