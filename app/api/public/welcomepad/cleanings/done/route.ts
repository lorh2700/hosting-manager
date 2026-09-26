import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { beds24Post } from '@/lib/beds24';

// API-key-gated pad actions. Completion updates an existing schedule only.
// Sending arrival instructions never writes a cleaning record.
type Body = {
  action?: 'complete' | 'send_message';
  date?: string;
  propertyKey?: string;
  bookingId?: string | null;
  completionNote?: string | null;
  message?: string | null;
};

const DEFAULT_ROOM_READY_MESSAGE =
  '안녕하세요! 객실 정비가 모두 완료되었습니다. 언제든 편안하게 체크인해 주세요.\n\n' +
  'Hello! Your room has been fully prepared. You may check in at your convenience.';

export async function POST(req: Request) {
  const expectedKey = process.env.WELCOMEPAD_API_KEY;
  if (!expectedKey) {
    return NextResponse.json({ error: 'WELCOMEPAD_API_KEY not configured' }, { status: 500 });
  }
  if (req.headers.get('x-api-key') !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const action = body.action ?? 'complete';
  if (action !== 'complete' && action !== 'send_message') return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  const propertyKey = typeof body.propertyKey === 'string' ? body.propertyKey.trim() : '';
  if (!propertyKey) {
    return NextResponse.json({ error: 'propertyKey is required' }, { status: 400 });
  }
  const bookingId = (body.bookingId ?? null) || null;
  const completionNote: string | null = body.completionNote ?? null;
  const messageOverride: string | null = (body.message ?? null) || null;

  const property = await prisma.property.findUnique({
    where: { welcomepadKey: propertyKey },
    select: { id: true, name: true, roomReadyMessage: true, doorPassword: true, addressUrl: true },
  });
  if (!property) {
    return NextResponse.json({ error: `propertyKey '${propertyKey}' not found` }, { status: 404 });
  }

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const now = new Date();

  if (body.date && body.date !== today) return NextResponse.json({ error: '날짜가 변경되었습니다. 화면을 새로고침해 주세요.' }, { status: 409 });
  if (action === 'complete') {
    const schedules = await prisma.cleaning.findMany({
      where: { propertyId: property.id, date: today }, orderBy: { createdAt: 'desc' },
    });
    const assigned = schedules.filter(row => row.cleanerId);
    const candidates = assigned.length ? assigned : schedules;
    if (!candidates.length) return NextResponse.json({ error: '오늘 등록된 청소 일정이 없습니다. 입실 안내만 보내려면 입실 안내 보내기를 눌러주세요.' }, { status: 409 });
    if (candidates.length !== 1) return NextResponse.json({ error: '청소 일정이 여러 건입니다. 관리자 캘린더에서 완료 처리해 주세요.' }, { status: 409 });
    const existing = candidates[0];
    if (existing.status === 'done') return NextResponse.json({ ok: true, cleaningId: existing.id, status: 'done', alreadyCompleted: true });
    const result = await prisma.cleaning.updateMany({
      where: { id: existing.id, propertyId: property.id, date: today, status: 'pending', cleanerId: existing.cleanerId },
      data: { status: 'done', completedAt: now, completionNote: completionNote ?? existing.completionNote },
    });
    if (result.count !== 1) return NextResponse.json({ error: '청소 일정이 변경되었습니다. 새로 확인해 주세요.' }, { status: 409 });
    return NextResponse.json({ ok: true, cleaningId: existing.id, status: 'done', completedAt: now });
  }

  // ── 2. Reservation lookup ─────────────────────────────────────────
  // 패드가 보낸 bookingId 우선 → 그 reservation 정확히 매칭.
  // 없으면 오늘 startDate 인 reservation fallback.
  // (channelId 필터는 의도적으로 안 검 — 기존 send/route.ts 와 동일하게,
  //  originalUid 가 있으면 Beds24 booking 으로 간주.)
  let reservation: { id: string; originalUid: string | null; title: string | null } | null = null;
  if (bookingId) {
    reservation = await prisma.event.findFirst({
      where: { propertyId: property.id, originalUid: bookingId, type: 'reservation', channelId: 'beds24', startDate: today },
      select: { id: true, originalUid: true, title: true },
    });
  }
  if (!bookingId) {
    const arrivals = await prisma.event.findMany({
      take: 2,
      where: { propertyId: property.id, type: 'reservation', channelId: 'beds24', startDate: today },
      select: { id: true, originalUid: true, title: true },
      orderBy: { createdAt: 'desc' },
    });
    if (arrivals.length > 1) return NextResponse.json({ error: '오늘 체크인 예약이 여러 건입니다. 관리자 대화 화면에서 수신자를 선택해 주세요.' }, { status: 409 });
    reservation = arrivals[0] ?? null;
  }

  // ── 3. Beds24 메시지 발송 ──────────────────────────────────────────
  // app/api/beds24/messages/send/route.ts 의 코어 로직과 동일.
  // {password}/{address} 치환은 캘린더 정비완료 경로(getRoomReadyMessage,
  // app/admin/calendar/types.ts)와 동일하게 적용 — 그동안 패드 경로에서만
  // 누락되어 토큰이 그대로 발송되던 버그 수정.
  const substituteTokens = (s: string) =>
    s
      .replace(/\{password\}/g, property.doorPassword || '')
      .replace(/\{address\}/g, property.addressUrl || '');

  let messageText: string;
  if (messageOverride) {
    messageText = substituteTokens(messageOverride);
  } else {
    messageText = substituteTokens(property.roomReadyMessage || DEFAULT_ROOM_READY_MESSAGE);
    // 커스텀 템플릿이 없을 때만 비번/주소를 자동으로 덧붙임 (getRoomReadyMessage 와 동일)
    if (!property.roomReadyMessage) {
      if (property.doorPassword) messageText += `\n\n비밀번호: ${property.doorPassword}`;
      if (property.addressUrl) messageText += `\n주소: ${property.addressUrl}`;
    }
  }
  const beds24BookingId = reservation?.originalUid || null;

  let messageStatus: 'sent' | 'failed' | 'no_reservation' | 'no_beds24_id' = 'no_reservation';
  let messageId: string | null = null;
  let messageError: string | null = null;

  if (reservation) {
    if (!beds24BookingId) {
      messageStatus = 'no_beds24_id';
      console.warn('[welcomepad/cleanings/done] reservation has no originalUid', {
        eventId: reservation.id, propertyKey,
      });
    } else {
      const guestName = (reservation.title || '게스트').replace(/ 예약$/, '');
      let deliveryStatus: 'sent' | 'failed' = 'failed';
      try {
        await beds24Post('/bookings/messages', [{
          bookingId: Number(beds24BookingId),
          message: messageText,
          type: 'host',
        }]);
        deliveryStatus = 'sent';
        console.log('[welcomepad/cleanings/done] beds24 message sent', {
          beds24BookingId, propertyKey, eventId: reservation.id,
        });
      } catch (err) {
        deliveryStatus = 'failed';
        messageError = err instanceof Error ? err.message : String(err);
        console.error('[welcomepad/cleanings/done] beds24 send failed', {
          beds24BookingId, propertyKey, error: messageError,
        });
      }

      const saved = await prisma.message.create({
        data: {
          eventId: reservation.id,
          propertyId: property.id,
          guestName,
          text: messageText,
          sender: 'host',
          read: true,
          type: 'message',
          deliveryStatus,
        },
      });
      messageId = saved.id;
      messageStatus = deliveryStatus;
    }
  } else {
    console.warn('[welcomepad/cleanings/done] no reservation found', {
      propertyKey, bookingId, today,
    });
  }

  return NextResponse.json({
    ok: messageStatus === 'sent',
    message: {
      status: messageStatus,
      messageId,
      eventId: reservation?.id ?? null,
      beds24BookingId,
      bookingIdSource: bookingId ? 'pad' : (reservation ? 'today_fallback' : null),
      error: messageError,
    },
  });
}
