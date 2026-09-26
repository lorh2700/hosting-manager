import { recordBooking, indexGuestSafely } from '@/lib/guest-history';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, readJson, str, requireManage } from '@/lib/core/http';
import { requireUnpaidBooking, requireUnpaidBedsBooking } from '@/lib/payments/guard';
import { cancelBeds24Booking } from '@/lib/beds24-register';
import { ensureCleaningsForProperty } from '@/lib/sync-engine';

export const POST = withAuth('bookings/cancel', async (req, { auth }) => {
  const id = str(await readJson(req), 'id', { required: true })!;
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) throw fail(404, '예약을 찾을 수 없습니다.');
  requireManage(auth, booking.propertyId);
  if (!['direct', 'beds24', 'Beds24', 'manual-reservation'].includes(booking.source ?? 'direct')) {
    throw fail(400, '외부 채널 예약은 해당 채널에서 취소해주세요.');
  }
  await requireUnpaidBooking(id);
  const ref = booking.channelBookingRef;
  if (ref) {
    await requireUnpaidBedsBooking(ref);
    const property = await prisma.property.findUnique({ where: { id: booking.propertyId }, select: { beds24RoomId: true } });
    if (!property?.beds24RoomId) throw fail(409, 'Beds24 객실 연결을 확인해주세요.');
    try { await cancelBeds24Booking(ref, property.beds24RoomId); }
    catch { throw fail(502, 'Beds24 취소를 확인하지 못했습니다. 예약은 유지됩니다. 잠시 후 다시 시도해주세요.'); }
  }
  await prisma.$transaction(async tx => {
    await tx.booking.update({ where: { id }, data: { status: 'cancelled' } });
    if (ref) await tx.event.deleteMany({ where: { propertyId: booking.propertyId, channelId: 'beds24', originalUid: ref } });
  });
  await indexGuestSafely(() => recordBooking({ ...booking, status: 'cancelled' }));
  let cleaningCleanupPending = false;
  await ensureCleaningsForProperty(booking.propertyId).catch(() => { cleaningCleanupPending = true; });
  return ok({ success: true, cleaningCleanupPending });
});
