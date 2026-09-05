import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, canManageProperty } from '@/lib/auth';
import { describeBeds24Error, BEDS24_REFRESH_TOKEN } from '@/lib/beds24';
import { registerBeds24BookingVerified, cancelBeds24Booking, ROUTE_BUDGET_MS } from '@/lib/beds24-register';
import { buildMaintenanceNotes, MAINTENANCE_TITLE } from '@/lib/beds24-booking';

const LOG = '[beds24/maintenance]';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function forbidden() {
  return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
}

/**
 * 객실정비(유지보수) 차단 등록.
 *
 * Beds24 에 블랙아웃(status=black)을 만들어 모든 채널의 날짜를 막고, 확인된 뒤에만
 * 플랫폼에 type='block', source='maintenance' 이벤트로 저장한다. 차단은 청소를
 * 만들지 않으므로 청소매니저 신청·알림·빨래 업체 캘린더 피드에 올라가지 않는다.
 *
 * Body: { propertyId, startDate, endDate, reason?, beds24BookingId? }
 *   endDate 는 예약과 같은 규칙(차단이 풀리는 날, exclusive).
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
    const { propertyId, startDate, endDate, reason, beds24BookingId: providedBookingId } = body;

    if (!propertyId || typeof propertyId !== 'string') {
      return NextResponse.json({ error: 'propertyId는 필수입니다.' }, { status: 400 });
    }
    if (typeof startDate !== 'string' || typeof endDate !== 'string' || !DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      return NextResponse.json({ error: 'startDate, endDate는 YYYY-MM-DD 형식이어야 합니다.' }, { status: 400 });
    }
    if (startDate >= endDate) {
      return NextResponse.json({ error: '종료일은 시작일보다 뒤여야 합니다.' }, { status: 400 });
    }
    if (!canManageProperty(auth, propertyId)) return forbidden();

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, beds24RoomId: true },
    });
    if (!property) return NextResponse.json({ error: '숙소를 찾을 수 없습니다.' }, { status: 404 });
    if (!property.beds24RoomId) {
      return NextResponse.json({ error: '해당 숙소에 Beds24 roomId가 설정되어 있지 않습니다.' }, { status: 400 });
    }

    const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 200) : '';

    const outcome = await registerBeds24BookingVerified({
      kind: 'block',
      roomId: Number(property.beds24RoomId),
      arrival: startDate,
      departure: endDate,
      firstName: MAINTENANCE_TITLE,
      lastName: '',
      numAdult: 1,
      numChild: 0,
      notes: buildMaintenanceNotes(trimmedReason),
      providedBookingId,
      deadlineAt,
      logPrefix: LOG,
    });
    if (!outcome.ok) return NextResponse.json(outcome.body, { status: outcome.status });

    const { bookingId, origin } = outcome;

    const eventData = {
      source: 'maintenance',
      title: MAINTENANCE_TITLE,
      startDate,
      endDate,
      type: 'block',
      description: [`사유: ${trimmedReason || '(미입력)'}`, '채널: 객실정비'].join('\n'),
      tags: ['maintenance'],
      guestEmail: null,
      guestPhone: null,
      numAdults: null,
      numChildren: null,
    };

    let event: { id: string };
    try {
      event = await prisma.event.upsert({
        where: {
          propertyId_channelId_originalUid: { propertyId, channelId: 'beds24', originalUid: String(bookingId) },
        },
        create: { propertyId, channelId: 'beds24', originalUid: String(bookingId), ...eventData },
        update: eventData,
        select: { id: true },
      });
    } catch (e) {
      console.error(`${LOG} local save failed for Beds24 block #${bookingId}:`, e);
      return NextResponse.json({
        error: `Beds24 정비 차단(#${bookingId})은 확인되었지만 플랫폼 저장에 실패했습니다. 잠시 후 'Beds24 확인 후 등록'을 눌러주세요.`,
        stage: 'local',
        pendingBeds24BookingId: String(bookingId),
      }, { status: 500 });
    }

    console.log(`${LOG} registered maintenance event ${event.id} for Beds24 block #${bookingId} (${origin})`);
    return NextResponse.json({
      success: true,
      eventId: event.id,
      beds24BookingId: String(bookingId),
      verified: true,
      origin,
    }, { status: 201 });
  } catch (error) {
    console.error(`${LOG} POST error:`, error);
    return NextResponse.json({ error: describeBeds24Error(error) }, { status: 500 });
  }
}

/**
 * 객실정비 해제. Query: ?eventId=<local event id>
 * Beds24 블랙아웃을 취소한 뒤 로컬 이벤트를 지운다.
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
    if (event.channelId !== 'beds24' || event.type !== 'block') {
      return NextResponse.json({ error: '이 이벤트는 Beds24 차단이 아닙니다.' }, { status: 400 });
    }
    if (!canManageProperty(auth, event.propertyId)) return forbidden();

    if (event.originalUid) {
      try {
        await cancelBeds24Booking(event.originalUid);
      } catch (e) {
        console.error(`${LOG} Beds24 cancel failed:`, e);
        return NextResponse.json({
          error: `Beds24에서 차단 해제에 실패했습니다 (${describeBeds24Error(e)}). 잠시 후 다시 시도해주세요.`,
        }, { status: 502 });
      }
    }

    await prisma.event.delete({ where: { id: eventId } });
    console.log(`${LOG} released maintenance event ${eventId} (Beds24 #${event.originalUid ?? '-'})`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`${LOG} DELETE error:`, error);
    return NextResponse.json({ error: describeBeds24Error(error) }, { status: 500 });
  }
}
