import { prisma } from '@/lib/prisma';
import { withErrors, ok } from '@/lib/core/http';

export const GET = withErrors('public/tours', async () => {
  const tours = await prisma.tour.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, slug: true, category: true, description: true, meetingPoint: true, durationMin: true, basePrice: true, maxGroupSize: true, images: true },
  });
  return ok(tours.map(t => ({ ...t, basePrice: t.basePrice ? Number(t.basePrice) : null })));
});
