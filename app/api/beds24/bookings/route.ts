import { prisma } from '@/lib/prisma';
import { describeBeds24Error, BEDS24_REFRESH_TOKEN } from '@/lib/beds24';
import { registerBeds24BookingVerified, cancelBeds24Booking, ROUTE_BUDGET_MS } from '@/lib/beds24-register';
import { withAuth, ok, created, fail, requireManage, readJson, str, int, dateStr } from '@/lib/core/http';

/**
 * 예약 관리 페이지의 Beds24 예약 생성. /api/beds24/reservations 와 같은 원칙:
 * Beds24 에 예약이 확인된 뒤에만 플랫폼 Booking 을 저장한다.
 * Beds24 booking id 는 channelBookingRef 에 보관해 취소가 Beds24 에도 반영되게 한다.
 */
export const POST = withAuth('beds24/bookings', async (req, { auth, log }) => {
  if (!BEDS24_REFRESH_TOKEN) throw fail(500, 'BEDS24_REFRESH_TOKEN is not configured');
  const deadlineAt = Date.now() + ROUTE_BUDGET_MS;

  const body = await readJson(req);
  const propertyId = str(body, 'propertyId', { required: true })!;
  const firstName = str(body, 'firstName', { required: true, max: 80 })!;
  const lastName = str(body, 'lastName', { max: 80 }) ?? '';
  const arrival = dateStr(body, 'arrival', { required: true })!;
  const departure = dateStr(body, 'departure', { required: true })!;
  if (arrival >= departure) throw fail(400, '체크아웃은 체크인보다 뒤여야 합니다.');
  requireManage(auth, propertyId);

  // Beds24 숙소 id 는 body 가 아니라 DB 설정에서 가져온다.
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { beds24PropId: true, beds24RoomId: true } });
  if (!property) throw fail(404, '숙소를 찾을 수 없습니다.');
  if (!property.beds24RoomId) throw fail(400, '이 숙소에는 Beds24 객실(roomId)이 설정되어 있지 않습니다.');

  const email = str(body, 'email', { max: 200 }) ?? '';
  const phone = str(body, 'phone', { max: 40 }) ?? '';
  const numAdult = int(body, 'numAdult', { min: 1, max: 20 }) ?? 1;
  const numChild = int(body, 'numChild', { min: 0, max: 20 }) ?? 0;
  const notes = str(body, 'notes', { max: 1000 }) ?? '';

  const outcome = await registerBeds24BookingVerified({
    kind: 'reservation',
    roomId: Number(property.beds24RoomId),
    arrival, departure, firstName, lastName, email, phone, numAdult, numChild, notes,
    providedBookingId: body.beds24BookingId,
    deadlineAt,
    logPrefix: '[beds24/bookings]',
  });
  if (!outcome.ok) throw fail(outcome.status, String(outcome.body.error), { ...outcome.body, error: undefined });

  // 플랫폼 저장 (Beds24 확인 완료 후에만). 같은 Beds24 예약이 이미 저장돼 있으면 재사용.
  const ref = String(outcome.bookingId);
  const already = await prisma.booking.findFirst({ where: { propertyId, channelBookingRef: ref }, select: { id: true } });
  const booking = already ?? await prisma.booking.create({
    data: {
      propertyId,
      name: [firstName, lastName].filter(Boolean).join(' '),
      email,
      phone,
      guests: numAdult + numChild,
      checkIn: arrival,
      checkOut: departure,
      status: 'confirmed',
      message: notes,
      source: 'beds24',
      channelBookingRef: ref,
    },
    select: { id: true },
  });

  log(`registered booking ${booking.id} for Beds24 #${ref} (${outcome.origin})`);
  return created({ success: true, bookingId: booking.id, beds24BookingId: ref, verified: true, reused: !!already });
});

export const PUT = withAuth('beds24/bookings', async (req, { auth }) => {
  if (!BEDS24_REFRESH_TOKEN) throw fail(500, 'BEDS24_REFRESH_TOKEN is not configured');
  const body = await readJson(req);
  const bookingId = str(body, 'bookingId', { required: true })!;
  const action = str(body, 'action', { required: true })!;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, propertyId: true, channelBookingRef: true, status: true },
  });
  if (!booking) throw fail(404, '예약을 찾을 수 없습니다.');
  requireManage(auth, booking.propertyId);

  if (action !== 'cancel') throw fail(400, '알 수 없는 작업입니다.');

  // 화면이 보낸 id 보다 DB 에 저장된 Beds24 참조를 우선한다.
  const ref = booking.channelBookingRef || (body.beds24BookingId ? String(body.beds24BookingId) : null);
  if (ref) {
    try {
      await cancelBeds24Booking(ref);
    } catch (e) {
      console.error('[beds24/bookings] Beds24 cancel failed:', e);
      throw fail(502, `Beds24에서 예약 취소에 실패했습니다 (${describeBeds24Error(e)}). 플랫폼 상태는 변경하지 않았습니다.`);
    }
  }

  await prisma.booking.update({ where: { id: booking.id }, data: { status: 'cancelled' } });
  return ok({ success: true, beds24Cancelled: !!ref });
});
