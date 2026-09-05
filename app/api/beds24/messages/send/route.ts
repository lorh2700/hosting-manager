import { NextRequest, NextResponse } from 'next/server';
import { beds24Post } from '@/lib/beds24';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, canManageProperty } from '@/lib/auth';

/**
 * POST /api/beds24/messages/send
 * Send a message to a guest via Beds24, and save a copy to DB.
 * For direct bookings (no Beds24 ID), saves as local memo only.
 * 권한: 그 예약이 속한 숙소를 관리하는 호스트/관리자만.
 */
export async function POST(req: NextRequest) {
  const auth = await getSessionWithUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { eventId, text } = await req.json() as {
      eventId: string;
      propertyId?: string;
      text: string;
    };

    if (!eventId || !text?.trim()) {
      return NextResponse.json({ error: 'eventId and text are required' }, { status: 400 });
    }

    // Look up the event to find Beds24 booking ID. propertyId 는 body 가 아니라
    // 예약 레코드에서 가져온다 (권한 검사 우회 방지).
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    let propertyId: string | null = null;
    let beds24BookingId: string | null = null;
    let guestName = '게스트';

    if (event) {
      propertyId = event.propertyId;
      beds24BookingId = event.originalUid || null;
      guestName = (event.title || '게스트').replace(/ 예약$/, '');
    } else {
      const booking = await prisma.booking.findUnique({ where: { id: eventId } });
      if (booking) {
        propertyId = booking.propertyId;
        guestName = booking.name || '게스트';
      }
    }

    if (!propertyId) {
      return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (!canManageProperty(auth, propertyId)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    let deliveryStatus: 'sent' | 'failed' | 'local_only' = 'local_only';
    let beds24Response: unknown = null;
    let beds24Error: string | null = null;

    if (beds24BookingId) {
      try {
        // Beds24 v2 POST /bookings/messages 표준 body — array of { bookingId, message }.
        // `type` 필드는 스펙에 없어서 그동안 무시됨. OTA(Airbnb/Booking) 로의
        // forward 는 Beds24 가 booking 의 channel 설정에 따라 자동 처리.
        //
        // ⚠ Airbnb 메시지가 실제 도달하려면 Beds24 측 설정 필요:
        //   Beds24 Dashboard → Settings → Channels → Airbnb → Messaging 활성화
        //   추가로 Airbnb thread 가 살아있어야 (체크아웃 14일 후 닫힘 등 정책).
        beds24Response = await beds24Post('/bookings/messages', [{
          bookingId: Number(beds24BookingId),
          message: text.trim(),
        }]);
        deliveryStatus = 'sent';
        // 응답 캡처 — 진단용. Beds24 가 forward 실패하면 응답에 error 포함될 수 있음.
        console.log('[beds24 send]', {
          bookingId: beds24BookingId,
          textLength: text.length,
          response: beds24Response,
        });
      } catch (err) {
        beds24Error = err instanceof Error ? err.message : String(err);
        console.error('[beds24 send] failed:', { bookingId: beds24BookingId, error: beds24Error });
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
      // 진단용 정보 — 클라이언트에선 무시해도 OK
      beds24Response,
      beds24Error,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Message send error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
