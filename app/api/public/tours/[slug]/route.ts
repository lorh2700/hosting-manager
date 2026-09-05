import { prisma } from '@/lib/prisma';
import { format, addDays } from 'date-fns';
import { withErrors, ok, fail } from '@/lib/core/http';

export const GET = withErrors<{ slug: string }>('public/tours/slug', async (_req, { params }) => {
  const tour = await prisma.tour.findUnique({
    where: { slug: params.slug },
    select: {
      id: true, title: true, slug: true, category: true, description: true, meetingPoint: true,
      durationMin: true, basePrice: true, maxGroupSize: true, images: true, isActive: true,
      durationOptions: { orderBy: [{ sortOrder: 'asc' }, { durationMin: 'asc' }], select: { id: true, label: true, durationMin: true, price: true } },
      ticketTiers: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, label: true, price: true, notes: true } },
    },
  });
  if (!tour || !tour.isActive) throw fail(404, 'not found');

  const today = format(new Date(), 'yyyy-MM-dd');
  const horizon = format(addDays(new Date(), 90), 'yyyy-MM-dd');
  const schedules = await prisma.tourSchedule.findMany({
    where: { tourId: tour.id, status: 'open', date: { gte: today, lte: horizon } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    select: { id: true, date: true, startTime: true, capacity: true, bookedCount: true },
  });

  return ok({
    ...tour,
    basePrice: tour.basePrice ? Number(tour.basePrice) : null,
    durationOptions: tour.durationOptions.map(o => ({ id: o.id, label: o.label, durationMin: o.durationMin, price: Number(o.price) })),
    ticketTiers: tour.ticketTiers.map(t => ({ id: t.id, label: t.label, price: Number(t.price), notes: t.notes })),
    slots: schedules.filter(s => s.bookedCount < s.capacity).map(s => ({ id: s.id, date: s.date, startTime: s.startTime, remaining: s.capacity - s.bookedCount })),
  });
});
