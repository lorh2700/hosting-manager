import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, authorizeTourBooking } from '@/lib/auth';
import { notifyTourOperatorOfBooking, notifyTourHostOfBooking } from '@/lib/notify';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const owned = await authorizeTourBooking(id, auth.session.userId, { isAdmin: auth.isAdmin });
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const booking = await prisma.tourBooking.findUnique({
      where: { id },
      include: {
        tour: {
          include: {
            operator: true,
            owner: { select: { id: true, displayName: true, email: true, phone: true } },
          },
        },
        schedule: true,
      },
    });
    if (!booking) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const commonNotifyOpts = {
      tourTitle: booking.tour.title,
      guestName: booking.name,
      guestPhone: booking.phone,
      guests: booking.guests,
      date: booking.schedule.date,
      startTime: booking.schedule.startTime,
      durationMin: booking.durationMin,
      totalPrice: booking.totalPrice ? Number(booking.totalPrice) : null,
      meetingPoint: booking.tour.meetingPoint,
      bookingId: booking.id,
    };

    await Promise.all([
      notifyTourOperatorOfBooking({ ...commonNotifyOpts, operator: booking.tour.operator }),
      notifyTourHostOfBooking({
        ...commonNotifyOpts,
        hostPhone: booking.tour.owner.phone,
        hostName: booking.tour.owner.displayName ?? booking.tour.owner.email,
      }),
    ]);

    await prisma.tourBooking.update({
      where: { id },
      data: { status: 'forwarded', forwardedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[tour-bookings/:id/forward] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
