import { beds24Post } from '@/lib/beds24';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, requireManage, readJson, str } from '@/lib/core/http';

/**
 * POST /api/beds24/messages/send
 * Send a message to a guest via Beds24, and save a copy to DB.
 * For direct bookings (no Beds24 ID), saves as local memo only.
 * 권한: 그 예약이 속한 숙소를 관리하는 호스트/관리자만.
 */
export const POST = withAuth('beds24/messages/send', async (req, { auth }) => {
  const body = await readJson(req);
  const eventId = str(body, 'eventId', { required: true })!;
  const text = str(body, 'text', { required: true })!.trim();
  if (!text) throw fail(400, 'eventId and text are required');

  // propertyId 는 body 가 아니라 예약 레코드에서 가져온다 (권한 검사 우회 방지).
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
    if (booking) { propertyId = booking.propertyId; guestName = booking.name || '게스트'; }
  }
  if (!propertyId) throw fail(404, '예약을 찾을 수 없습니다.');
  requireManage(auth, propertyId);

  let deliveryStatus: 'sent' | 'failed' | 'local_only' = 'local_only';
  let beds24Response: unknown = null;
  let beds24Error: string | null = null;

  if (beds24BookingId) {
    try {
      // Beds24 v2 POST /bookings/messages — OTA 로의 forward 는 Beds24 가 채널 설정에 따라 처리.
      // ⚠ Airbnb 도달에는 Beds24 Dashboard → Channels → Airbnb → Messaging 활성화가 필요.
      beds24Response = await beds24Post('/bookings/messages', [{ bookingId: Number(beds24BookingId), message: text }]);
      deliveryStatus = 'sent';
      console.log('[beds24 send]', { bookingId: beds24BookingId, textLength: text.length, response: beds24Response });
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
      text,
      sender: 'host',
      read: true,
      type: beds24BookingId ? 'message' : 'memo',
      deliveryStatus,
    },
  });

  return ok({ id: message.id, deliveryStatus, isBeds24: !!beds24BookingId, beds24Response, beds24Error });
});
