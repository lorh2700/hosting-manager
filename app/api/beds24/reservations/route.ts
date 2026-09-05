import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';
import { ensureCleaningsForProperty } from '@/lib/sync-engine';
import { describeBeds24Error, BEDS24_REFRESH_TOKEN } from '@/lib/beds24';
import { registerBeds24BookingVerified, cancelBeds24Booking, ROUTE_BUDGET_MS } from '@/lib/beds24-register';

const LOG = '[beds24/reservations]';

function forbidden() {
  return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
}

/**
 * 직접 예약 등록. 플랫폼 저장은 Beds24 등록이 "확인된 뒤에만" 한다 (lib/beds24-register 참조).
 *
 * Body: {
 *   propertyId, startDate (arrival), endDate (departure),
 *   name, email?, phone?, numAdult?, numChild?, notes?, tags?,
 *   beds24BookingId?  — 이전 시도에서 Beds24 등록까지는 됐지만 확인/저장에 실패한 경우.
 * }
 * 실패 응답에 pendingBeds24BookingId 가 있으면 Beds24 에는 예약이 있고 플랫폼에는 아직 없다는 뜻.
 * clearPending 이 true 면 클라이언트는 보관 중인 pending id 를 버려야 한다.
 */
export async function POST(req: Request) {
  if (!BEDS24_REFRESH_TOKEN) {
    return NextResponse.json({ error: 'BEDS24_REFRESH_TOKEN이 설정되지 않았습니다.' }, { status: 500 });
  }
  const deadlineAt = Date.now() + ROUTE_BUDGET_MS;

  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      propertyId, startDate, endDate,
      name, email, phone, numAdult, numChild, notes, tags,
      beds24BookingId: providedBookingId,
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

    const arrival = String(startDate);
    const departure = String(endDate);

    const outcome = await registerBeds24BookingVerified({
      kind: 'reservation',
      roomId: Number(property.beds24RoomId),
      arrival,
      departure,
      firstName: firstName || trimmedName,
      lastName: lastName || '',
      email: trimmedEmail,
      phone: trimmedPhone,
      numAdult: adults,
      numChild: children,
      notes: trimmedNotes,
      providedBookingId,
      deadlineAt,
      logPrefix: LOG,
    });
    if (!outcome.ok) return NextResponse.json(outcome.body, { status: outcome.status });

    const { bookingId, origin } = outcome;

    // ── 플랫폼 저장 (Beds24 확인 완료 후에만) ──
    const descriptionParts = [
      `게스트: ${trimmedName}`,
      trimmedEmail ? `이메일: ${trimmedEmail}` : '',
      trimmedPhone ? `연락처: ${trimmedPhone}` : '',
      `인원: 성인 ${adults}명${children > 0 ? `, 아동 ${children}명` : ''}`,
      `채널: 직접 등록`,
      trimmedNotes ? `메모: ${trimmedNotes}` : '',
    ].filter(Boolean).join('\n');

    const eventData = {
      source: 'manual-reservation',
      title: trimmedName,
      startDate: arrival,
      endDate: departure,
      type: 'reservation',
      description: descriptionParts,
      tags: sanitizedTags,
      guestEmail: trimmedEmail || null,
      guestPhone: trimmedPhone || null,
      numAdults: adults,
      numChildren: children,
    };

    let event: { id: string };
    try {
      // 동기화 크론이 먼저 같은 Beds24 예약을 가져왔을 수도 있으므로 upsert.
      event = await prisma.event.upsert({
        where: {
          propertyId_channelId_originalUid: { propertyId, channelId: 'beds24', originalUid: String(bookingId) },
        },
        create: { propertyId, channelId: 'beds24', originalUid: String(bookingId), ...eventData },
        update: eventData,
        select: { id: true },
      });
    } catch (e) {
      console.error(`${LOG} local save failed for Beds24 booking #${bookingId}:`, e);
      return NextResponse.json({
        error: `Beds24 예약(#${bookingId}) 등록은 확인되었지만 플랫폼 저장에 실패했습니다. 잠시 후 'Beds24 확인 후 등록'을 눌러주세요.`,
        stage: 'local',
        pendingBeds24BookingId: String(bookingId),
      }, { status: 500 });
    }

    console.log(`${LOG} registered event ${event.id} for Beds24 booking #${bookingId} (${origin})`);
    return NextResponse.json({
      success: true,
      eventId: event.id,
      beds24BookingId: String(bookingId),
      verified: true,
      origin,
      beds24Status: outcome.booking.status ?? null,
    }, { status: 201 });
  } catch (error) {
    console.error(`${LOG} POST error:`, error);
    return NextResponse.json({ error: describeBeds24Error(error) }, { status: 500 });
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
        await cancelBeds24Booking(event.originalUid);
      } catch (e) {
        console.error(`${LOG} Beds24 cancel failed:`, e);
        return NextResponse.json({
          error: `Beds24에서 예약 취소에 실패했습니다 (${describeBeds24Error(e)}). 네트워크 또는 권한을 확인하세요.`,
          detail: String(e),
        }, { status: 502 });
      }
    }

    await prisma.event.delete({ where: { id: eventId } });

    // 취소된 예약의 자동 생성 청소를 바로 정리 (다음 동기화까지 기다리지 않도록).
    await ensureCleaningsForProperty(event.propertyId).catch(err => {
      console.error(`${LOG} cleaning cleanup after cancel failed:`, err);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`${LOG} DELETE error:`, error);
    return NextResponse.json({ error: describeBeds24Error(error) }, { status: 500 });
  }
}
