import { listAssignees } from '@/lib/staff-directory';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth, query } from '@/lib/core/http';
import { calendarMonthRange } from '@/lib/calendar-month';

export const GET = withAuth('admin/calendar', async (req, { auth }) => {
  const t0 = Date.now();
  const timings: Record<string, number> = {};

  const { first: rangeFrom, last: rangeTo } = calendarMonthRange(query(req, 'month'));

  const tProps = Date.now();
  const properties = await prisma.property.findMany({
    where: auth.isAdmin ? {} : { id: { in: auth.propertyIds ?? [] } },
    select: {
      id: true, name: true, doorPassword: true, addressUrl: true, roomReadyMessage: true,
      channels: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  timings.properties = Date.now() - tProps;

  const propertyIds = properties.map(p => p.id);
  if (propertyIds.length === 0) {
    return NextResponse.json({ properties: [], channelMap: {}, events: [], bookings: [], cleanings: [], cleaners: [] });
  }

  const pidFilter = { propertyId: { in: propertyIds } };

  // SupplyTodos come from /api/admin/calendar/supply-todos so the grid renders with one fewer query.
  const tQueries = Date.now();
  const [events, bookings, cleanings, cleaners] = await Promise.all([
    prisma.event.findMany({
      where: { ...pidFilter, endDate: { gte: rangeFrom }, startDate: { lte: rangeTo } },
      select: {
        id: true, propertyId: true, channelId: true, source: true,
        title: true, startDate: true, endDate: true, type: true, description: true,
        tags: true, originalUid: true,
      },
      orderBy: { startDate: 'asc' },
    }),
    prisma.booking.findMany({
      where: { ...pidFilter, status: 'confirmed', checkOut: { gte: rangeFrom }, checkIn: { lte: rangeTo } },
      select: { id: true, propertyId: true, name: true, email: true, guests: true, checkIn: true, checkOut: true },
      orderBy: { checkIn: 'asc' },
    }),
    prisma.cleaning.findMany({
      where: { ...pidFilter, date: { gte: rangeFrom, lte: rangeTo } },
      select: { id: true, propertyId: true, date: true, cleanerId: true, status: true, supplies: true },
      orderBy: { date: 'desc' },
    }),
    listAssignees(auth),
  ]);
  timings.queries = Date.now() - tQueries;

  const channelMap: Record<string, string> = {};
  for (const p of properties) {
    for (const ch of p.channels) channelMap[ch.name || ch.id] = ch.name || ch.id;
  }

  timings.total = Date.now() - t0;
  if (timings.total > 500) {
    console.warn('[admin/calendar] slow GET', { timings, eventCount: events.length, bookingCount: bookings.length, cleaningCount: cleanings.length });
  }

  return NextResponse.json(
    {
      properties: properties.map(p => ({
        id: p.id, name: p.name, doorPassword: p.doorPassword, addressUrl: p.addressUrl, roomReadyMessage: p.roomReadyMessage,
      })),
      channelMap,
      events,
      bookings,
      cleanings,
      cleaners,
      // Empty array — supplyTodos now fetched separately. Field kept for backwards-compat.
      supplyTodos: [],
      _timings: process.env.NODE_ENV === 'development' ? timings : undefined,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
});
