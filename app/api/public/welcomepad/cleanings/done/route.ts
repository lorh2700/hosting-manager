import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { beds24Post } from '@/lib/beds24';

// Public-but-API-key-gated endpoint that the welcome-pad calls when the
// host taps "정비 완료" on the kiosk's cleaning overlay. Two side effects:
//   1. Mark today's cleaning row as done (creating one if no schedule existed).
//   2. Send a "your room is ready" message to the guest via the OTA channel
//      they booked through (currently Beds24 only — Beds24 federates
//      Airbnb / Booking.com / 네이버 / etc).
//
// Auth: x-api-key header (env: WELCOMEPAD_API_KEY) — same secret as /checkins.
// Body: { propertyKey: 'anon', completionNote?: string|null, message?: string|null }
//   - completionNote: internal cleaning note (saved on Cleaning row)
//   - message: override for the guest-facing text. If omitted, falls back to
//     Property.roomReadyMessage, then to the bilingual default below.
//
// "Today" = Asia/Seoul date — pads run in KR timezone.

type Body = {
  propertyKey?: string;
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

  const propertyKey = (body.propertyKey || '').trim();
  if (!propertyKey) {
    return NextResponse.json({ error: 'propertyKey is required' }, { status: 400 });
  }
  if ('completionNote' in body
      && body.completionNote !== null
      && typeof body.completionNote !== 'string') {
    return NextResponse.json({ error: 'completionNote must be string or null' }, { status: 400 });
  }
  if ('message' in body && body.message !== null && typeof body.message !== 'string') {
    return NextResponse.json({ error: 'message must be string or null' }, { status: 400 });
  }
  const completionNote: string | null = body.completionNote ?? null;
  const messageOverride: string | null = (body.message ?? null) || null;

  const property = await prisma.property.findUnique({
    where: { welcomepadKey: propertyKey },
    select: { id: true, name: true, roomReadyMessage: true },
  });
  if (!property) {
    return NextResponse.json({ error: `propertyKey '${propertyKey}' not found` }, { status: 404 });
  }

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const now = new Date();

  // ── 1. Cleaning row 갱신/생성 ──────────────────────────────────────
  const existing = await prisma.cleaning.findFirst({
    where: { propertyId: property.id, date: today },
    orderBy: { createdAt: 'desc' },
  });

  const cleaning = existing
    ? await prisma.cleaning.update({
        where: { id: existing.id },
        data: {
          status: 'done',
          completedAt: existing.status === 'done' ? existing.completedAt : now,
          completionNote: completionNote ?? existing.completionNote,
        },
      })
    : await prisma.cleaning.create({
        data: {
          propertyId: property.id,
          date: today,
          status: 'done',
          completedAt: now,
          completionNote,
          assignmentType: 'direct',
        },
      });

  // ── 2. 오늘 체크인 게스트에게 "객실 준비 완료" 메시지 ──────────────
  // 머무는 중인 게스트(어제 이전 체크인)에겐 보내지 않음 — "정비 완료" 알림은
  // 새로 들어오는 게스트한테만 의미가 있음.
  const arrivingToday = await prisma.event.findFirst({
    where: {
      propertyId: property.id,
      channelId: 'beds24',
      type: 'reservation',
      startDate: today,
    },
    select: { id: true, originalUid: true, title: true },
    orderBy: { createdAt: 'desc' },
  });

  const messageText = messageOverride ?? property.roomReadyMessage ?? DEFAULT_ROOM_READY_MESSAGE;

  let messageStatus: 'sent' | 'failed' | 'no_arriving_guest' | 'no_beds24_id' = 'no_arriving_guest';
  let messageId: string | null = null;

  if (arrivingToday) {
    const beds24BookingId = arrivingToday.originalUid || null;
    const guestName = (arrivingToday.title || '게스트').replace(/ 예약$/, '');

    if (beds24BookingId) {
      let deliveryStatus: 'sent' | 'failed' = 'failed';
      try {
        await beds24Post('/bookings/messages', [{
          bookingId: Number(beds24BookingId),
          message: messageText,
          type: 'host',
        }]);
        deliveryStatus = 'sent';
      } catch (err) {
        console.error('[welcomepad/cleanings/done] Beds24 message send failed:', err);
        deliveryStatus = 'failed';
      }

      const saved = await prisma.message.create({
        data: {
          eventId: arrivingToday.id,
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
    } else {
      // 다이렉트 예약 등 Beds24 ID 가 없는 케이스 — 외부 채널이 없으니 발송 불가
      messageStatus = 'no_beds24_id';
    }
  }

  return NextResponse.json({
    ok: true,
    cleaningId: cleaning.id,
    status: cleaning.status,
    completedAt: cleaning.completedAt,
    message: {
      status: messageStatus,
      messageId,
      // 디버깅용 — 어떤 reservation 으로 보냈는지
      eventId: arrivingToday?.id ?? null,
    },
  });
}
