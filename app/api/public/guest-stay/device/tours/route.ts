import { withErrors } from '@/lib/core/http';
import { prisma } from '@/lib/prisma';
import { privateStayResponse, requireStayDevice } from '@/lib/guest-stay-store';
export const GET = withErrors('guest-stay/device/tours', async req => {
  await requireStayDevice(req);
  const tours = await prisma.tour.findMany({ where: { isActive: true }, take: 100, orderBy: { title: 'asc' },
    select: { id: true, slug: true, title: true, durationOptions: { select: { id: true, label: true, durationMin: true, price: true }, orderBy: { sortOrder: 'asc' } },
      ticketTiers: { select: { id: true, label: true, price: true }, orderBy: { sortOrder: 'asc' } } } });
  return privateStayResponse({ tours: tours.map(t => ({ ...t, durationOptions: t.durationOptions.map(o => ({ ...o, price: Number(o.price) })), ticketTiers: t.ticketTiers.map(o => ({ ...o, price: Number(o.price) })) })) });
});
