import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';
import { beds24Post, beds24Put, BEDS24_REFRESH_TOKEN } from '@/lib/beds24';

function forbidden() {
  return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
}

/**
 * Register a direct reservation through Beds24 so the dates are marked as
 * booked across all connected channels.
 *
 * Body: {
 *   propertyId, startDate (arrival), endDate (departure),
 *   name, email?, phone?, numAdult?, numChild?, notes?, tags?
 * }
 */
export async function POST(req: Request) {
  if (!BEDS24_REFRESH_TOKEN) {
    return NextResponse.json({ error: 'BEDS24_REFRESH_TOKEN이 설정되지 않았습니다.' }, { status: 500 });
  }
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      propertyId, startDate, endDate,
      name, email, phone, numAdult, numChild, notes, tags,
    } = body;

    if (!propertyId || !startDate || !endDate || !name) {
      return NextResponse.json({ error: 'propertyId, startDate, endDate, name은 필수입니다.' }, { status: 400 });
    }
    if (startDate >= endDate) {
      return NextResponse.json({ error: '체크아웃은 체크인보다 뒤여야 합니다.' }, { status: 400 });
    }
    if (!auth.isAdmin && !(auth.propertyIds ?? []).includes(propertyId)) {
      return forbidden();
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, beds24PropId: true, beds24RoomId: true },
    });
    if (!property) return NextResponse.json({ error: '숙소를 찾을 수 없습니다.' }, { status: 404 });
    if (!property.beds24RoomId) {
      return NextResponse.json({ error: '해당 숙소에 Beds24 roomId가 설정되어 있지 않습니다.' }, { status: 400 });
    }

    const trimmedName = String(name).slice(0, 80).trim();
    const [firstName, ...rest] = trimmedName.split(/\s+/);
    const lastName = rest.join(' ');
    const trimmedNotes = notes ? String(notes).slice(0, 1000) : '';
    const trimmedEmail = email ? String(email).slice(0, 200).trim() : '';
    const trimmedPhone = phone ? String(phone).slice(0, 40).trim() : '';
    const adults = Math.max(1, Math.min(20, Number(numAdult) || 1));
    const children = Math.max(0, Math.min(20, Number(numChild) || 0));
    const sanitizedTags = Array.isArray(tags)
      ? (tags as unknown[])
          .map(t => typeof t === 'string' ? t.trim() : '')
          .filter((t): t is string => t.length > 0 && t.length <= 40)
          .slice(0, 20)
      : [];

    const beds24Response = await beds24Post('/bookings', [{
      roomId: Number(property.beds24RoomId),
      arrival: startDate,
      departure: endDate,
      firstName: firstName || trimmedName,
      lastName: lastName || '',
      email: trimmedEmail,
      phone: trimmedPhone,
      numAdult: adults,
      numChild: children,
      status: 'confirmed',
      notes: trimmedNotes,
    }]);

    const created = Array.isArray(beds24Response) ? beds24Response[0] : beds24Response;
    const beds24BookingId =
      created?.new?.id ??
      created?.id ??
      created?.bookingId ??
      null;

    if (!beds24BookingId) {
      console.error('[beds24/reservations] Beds24 did not return booking id:', JSON.stringify(beds24Response).slice(0, 500));
      return NextResponse.json({
        error: 'Beds24에서 예약 생성에 실패했습니다.',
        beds24Response,
      }, { status: 502 });
    }

    const descriptionParts = [
      `게스트: ${trimmedName}`,
      trimmedEmail ? `이메일: ${trimmedEmail}` : '',
      trimmedPhone ? `연락처: ${trimmedPhone}` : '',
      `인원: 성인 ${adults}명${children > 0 ? `, 아동 ${children}명` : ''}`,
      `채널: 직접 등록`,
      trimmedNotes ? `메모: ${trimmedNotes}` : '',
    ].filter(Boolean).join('\n');

    const event = await prisma.event.create({
      data: {
        propertyId,
        channelId: 'beds24',
        source: 'manual-reservation',
        title: trimmedName,
        startDate,
        endDate,
        type: 'reservation',
        originalUid: String(beds24BookingId),
        description: descriptionParts,
        tags: sanitizedTags,
      },
    });

    await prisma.booking.create({
      data: {
        propertyId,
        name: trimmedName,
        email: trimmedEmail,
        phone: trimmedPhone,
        guests: adults + children,
        checkIn: startDate,
        checkOut: endDate,
        status: 'confirmed',
        message: trimmedNotes,
        source: 'manual-reservation',
      },
    });

    return NextResponse.json({
      success: true,
      eventId: event.id,
      beds24BookingId: String(beds24BookingId),
    }, { status: 201 });
  } catch (error) {
    console.error('[beds24/reservations] POST error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * Cancel a Beds24 booking (reservation or block) for an event we have locally.
 * Query: ?eventId=<local event id>
 */
export async function DELETE(req: Request) {
  if (!BEDS24_REFRESH_TOKEN) {
    return NextResponse.json({ error: 'BEDS24_REFRESH_TOKEN이 설정되지 않았습니다.' }, { status: 500 });
  }
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');
    if (!eventId) return NextResponse.json({ error: 'eventId는 필수입니다.' }, { status: 400 });

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, propertyId: true, channelId: true, type: true, originalUid: true, source: true },
    });
    if (!event) return NextResponse.json({ error: '이벤트를 찾을 수 없습니다.' }, { status: 404 });
    if (event.channelId !== 'beds24') {
      return NextResponse.json({ error: '이 이벤트는 Beds24 예약이 아닙니다.' }, { status: 400 });
    }
    if (!auth.isAdmin && !(auth.propertyIds ?? []).includes(event.propertyId)) {
      return forbidden();
    }

    if (event.originalUid) {
      try {
        await beds24Put('/bookings', [{
          id: Number(event.originalUid),
          status: 'cancelled',
        }]);
      } catch (e) {
        console.error('[beds24/reservations] Beds24 cancel failed:', e);
        return NextResponse.json({
          error: 'Beds24에서 예약 취소에 실패했습니다. 네트워크 또는 권한을 확인하세요.',
          detail: String(e),
        }, { status: 502 });
      }
    }

    await prisma.event.delete({ where: { id: eventId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[beds24/reservations] DELETE error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
