import { prisma } from '@/lib/prisma';
import { authorizeTourBooking } from '@/lib/auth';
import { notifyTourOperatorOfBooking, notifyTourHostOfBooking } from '@/lib/notify';
import { getTourNotificationRecipient } from '@/lib/tour-notification-recipients';
import { withAuth, ok, fail, MESSAGES } from '@/lib/core/http';

type Params = { id: string };

// 예약을 운영업체에 전달(알림)하고 상태를 forwarded 로 바꾼다.
export const POST = withAuth<Params>('tour-bookings/forward', async (_req, { auth, params }) => {
  if (!(await authorizeTourBooking(params.id, auth.session.userId, { isAdmin: auth.isAdmin, auth }))) throw fail(403, MESSAGES.forbidden);

  const booking = await prisma.tourBooking.findUnique({
    where: { id: params.id },
    include: {
      tour: { include: { operator: true, owner: { select: { id: true, organizationId: true, displayName: true, email: true, phone: true } } } },
      schedule: true,
    },
  });
  if (!booking) throw fail(404, MESSAGES.notFound);

  const commonNotifyOpts = {
    tourTitle: booking.tour.title,
    guestName: booking.name,
    guestPhone: booking.phone,
    guests: booking.guests,
    date: booking.schedule?.date ?? booking.requestedDate!,
    startTime: booking.schedule?.startTime ?? booking.requestedTime!,
    durationMin: booking.durationMin,
    totalPrice: booking.totalPrice ? Number(booking.totalPrice) : null,
    meetingPoint: booking.tour.meetingPoint,
    bookingId: booking.id,
  };

  await Promise.all([
    notifyTourOperatorOfBooking({ ...commonNotifyOpts, operator: booking.tour.operator }),
    getTourNotificationRecipient(booking.tour).then(recipient => notifyTourHostOfBooking({
      ...commonNotifyOpts, hostPhone: recipient?.phone ?? null, hostName: recipient?.name ?? '',
    })).catch(() => console.error('[tour-bookings/forward] host notify failed', { bookingId: booking.id })),
  ]);

  await prisma.tourBooking.update({ where: { id: params.id }, data: { status: 'forwarded', forwardedAt: new Date() } });
  return ok({ success: true });
});
