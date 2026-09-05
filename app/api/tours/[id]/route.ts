import { prisma } from '@/lib/prisma';
import { authorizeTour } from '@/lib/auth';
import { withAuth, ok, fail, MESSAGES } from '@/lib/core/http';

type Params = { id: string };

export const GET = withAuth<Params>('tours/id', async (_req, { auth, params }) => {
  if (!(await authorizeTour(params.id, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);

  const tour = await prisma.tour.findUnique({
    where: { id: params.id },
    include: {
      operator: true,
      schedules: { orderBy: [{ date: 'asc' }, { startTime: 'asc' }] },
      durationOptions: { orderBy: [{ sortOrder: 'asc' }, { durationMin: 'asc' }] },
      ticketTiers: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      _count: { select: { bookings: true } },
    },
  });
  if (!tour) throw fail(404, MESSAGES.notFound);

  return ok({
    ...tour,
    basePrice: tour.basePrice ? Number(tour.basePrice) : null,
    durationOptions: tour.durationOptions.map(o => ({ id: o.id, label: o.label, durationMin: o.durationMin, price: Number(o.price), sortOrder: o.sortOrder })),
    ticketTiers: tour.ticketTiers.map(t => ({ id: t.id, label: t.label, price: Number(t.price), notes: t.notes, sortOrder: t.sortOrder })),
  });
});
