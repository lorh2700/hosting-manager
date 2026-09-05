import { prisma } from '@/lib/prisma';
import { format, addDays } from 'date-fns';
import { withAuth, ok } from '@/lib/core/http';

export const GET = withAuth('tour-dashboard', async (_req, { auth }) => {
  const ownerWhere = auth.isAdmin ? {} : { ownerId: auth.session.userId };
  const tourBookingWhere = auth.isAdmin ? {} : { tour: { ownerId: auth.session.userId } };

  const today = format(new Date(), 'yyyy-MM-dd');
  const weekEnd = format(addDays(new Date(), 6), 'yyyy-MM-dd');

  const [activeTourCount, operatorCount, todaySchedules, weekBookings, pendingCount, recentBookings] = await Promise.all([
    prisma.tour.count({ where: { ...ownerWhere, isActive: true } }),
    prisma.tourOperator.count({ where: ownerWhere }),
    prisma.tourSchedule.findMany({
      where: { tour: ownerWhere, date: today },
      include: {
        tour: { select: { id: true, title: true } },
        bookings: { where: { status: { not: 'cancelled' } }, select: { id: true, name: true, guests: true, status: true, phone: true } },
      },
      orderBy: { startTime: 'asc' },
    }),
    prisma.tourBooking.count({ where: { ...tourBookingWhere, status: { not: 'cancelled' }, schedule: { date: { gte: today, lte: weekEnd } } } }),
    prisma.tourBooking.count({ where: { ...tourBookingWhere, status: 'pending' } }),
    prisma.tourBooking.findMany({
      where: tourBookingWhere,
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { tour: { select: { id: true, title: true } }, schedule: { select: { date: true, startTime: true } } },
    }),
  ]);

  return ok({
    activeTourCount,
    operatorCount,
    weekBookingCount: weekBookings,
    pendingCount,
    todaySchedules: todaySchedules.map(s => ({
      id: s.id, date: s.date, startTime: s.startTime, capacity: s.capacity, bookedCount: s.bookedCount, status: s.status, tour: s.tour, bookings: s.bookings,
    })),
    recentBookings: recentBookings.map(b => ({
      id: b.id, name: b.name, phone: b.phone, guests: b.guests, status: b.status, createdAt: b.createdAt, tour: b.tour, schedule: b.schedule,
    })),
  });
});
