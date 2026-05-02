import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';
import { format, addDays } from 'date-fns';

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerWhere = auth.isAdmin ? {} : { ownerId: auth.session.userId };
    const tourBookingWhere = auth.isAdmin ? {} : { tour: { ownerId: auth.session.userId } };

    const today = format(new Date(), 'yyyy-MM-dd');
    const weekEnd = format(addDays(new Date(), 6), 'yyyy-MM-dd');

    const [
      activeTourCount,
      operatorCount,
      todaySchedules,
      weekBookings,
      pendingCount,
      recentBookings,
    ] = await Promise.all([
      prisma.tour.count({ where: { ...ownerWhere, isActive: true } }),
      prisma.tourOperator.count({ where: ownerWhere }),
      prisma.tourSchedule.findMany({
        where: { tour: ownerWhere, date: today },
        include: {
          tour: { select: { id: true, title: true } },
          bookings: {
            where: { status: { not: 'cancelled' } },
            select: { id: true, name: true, guests: true, status: true, phone: true },
          },
        },
        orderBy: { startTime: 'asc' },
      }),
      prisma.tourBooking.count({
        where: {
          ...tourBookingWhere,
          status: { not: 'cancelled' },
          schedule: { date: { gte: today, lte: weekEnd } },
        },
      }),
      prisma.tourBooking.count({
        where: { ...tourBookingWhere, status: 'pending' },
      }),
      prisma.tourBooking.findMany({
        where: tourBookingWhere,
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          tour: { select: { id: true, title: true } },
          schedule: { select: { date: true, startTime: true } },
        },
      }),
    ]);

    return NextResponse.json({
      activeTourCount,
      operatorCount,
      weekBookingCount: weekBookings,
      pendingCount,
      todaySchedules: todaySchedules.map(s => ({
        id: s.id,
        date: s.date,
        startTime: s.startTime,
        capacity: s.capacity,
        bookedCount: s.bookedCount,
        status: s.status,
        tour: s.tour,
        bookings: s.bookings,
      })),
      recentBookings: recentBookings.map(b => ({
        id: b.id,
        name: b.name,
        phone: b.phone,
        guests: b.guests,
        status: b.status,
        createdAt: b.createdAt,
        tour: b.tour,
        schedule: b.schedule,
      })),
    });
  } catch (e) {
    console.error('[tour-dashboard] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
