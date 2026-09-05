import { prisma } from '@/lib/prisma';
import { withAuth, ok } from '@/lib/core/http';

// 예약 관리 페이지: 담당 숙소의 직접 예약(Booking)과 예약 이벤트(Event)를 함께 돌려준다.
export const GET = withAuth('admin/bookings', async (_req, { auth }) => {
  const properties = await prisma.property.findMany({
    where: auth.isAdmin ? {} : { id: { in: auth.propertyIds ?? [] } },
    select: { id: true, name: true, beds24PropId: true },
    orderBy: { createdAt: 'desc' },
  });
  const propertyIds = properties.map(p => p.id);
  if (propertyIds.length === 0) return ok({ properties: [], bookings: [], events: [] });

  const pidFilter = { propertyId: { in: propertyIds } };
  const [bookings, events] = await Promise.all([
    prisma.booking.findMany({ where: pidFilter, orderBy: { createdAt: 'desc' }, take: 1000 }),
    prisma.event.findMany({ where: { ...pidFilter, type: 'reservation' }, orderBy: { startDate: 'asc' }, take: 2000 }),
  ]);

  return ok({ properties, bookings, events });
});
