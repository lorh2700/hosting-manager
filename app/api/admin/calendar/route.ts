import { listAssignees } from '@/lib/staff-directory';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth, query } from '@/lib/core/http';
import { calendarGridRange } from '@/lib/calendar-month';

export const GET = withAuth('admin/calendar', async (req, { auth }) => {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const timed = async <T>(name: string, read: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await read();
    } finally {
      timings[name] = performance.now() - started;
    }
  };
  const headers = () => ({
    'Cache-Control': 'private, no-store',
    'Server-Timing': Object.entries(timings).map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`).join(', '),
  });

  const { first: rangeFrom, last: rangeTo } = calendarGridRange(query(req, 'month'));

  const properties = await timed('properties', () => prisma.property.findMany({
    where: auth.isAdmin ? {} : { id: { in: auth.propertyIds ?? [] } },
    select: {
      id: true, name: true, doorPassword: true, addressUrl: true, roomReadyMessage: true,
      channels: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  }));

  const propertyIds = properties.map(p => p.id);
  if (propertyIds.length === 0) {
    timings.total = performance.now() - t0;
    return NextResponse.json({ properties: [], channelMap: {}, events: [], bookings: [], cleanings: [], cleaners: [] }, { headers: headers() });
  }

  const pidFilter = { propertyId: { in: propertyIds } };

  // SupplyTodos come from /api/admin/calendar/supply-todos so the grid renders with one fewer query.
  const tQueries = performance.now();
  // Cleaning only depends on visible stays. A slow staff directory must not
  // postpone its query; keep both branches concurrent until the response join.
  const staysAndCleanings = (async () => {
    const [events, bookings] = await Promise.all([
      timed('events', () => prisma.event.findMany({
        where: { ...pidFilter, endDate: { gte: rangeFrom }, startDate: { lte: rangeTo } },
        select: {
          id: true, propertyId: true, channelId: true, source: true,
          title: true, startDate: true, endDate: true, type: true, description: true,
          tags: true, originalUid: true,
        },
        orderBy: { startDate: 'asc' },
      })),
      timed('bookings', () => prisma.booking.findMany({
        where: { ...pidFilter, status: 'confirmed', checkOut: { gte: rangeFrom }, checkIn: { lte: rangeTo } },
        select: { id: true, propertyId: true, name: true, email: true, guests: true, checkIn: true, checkOut: true },
        orderBy: { checkIn: 'asc' },
      })),
    ]);
    // Visible stays can check out next month. The event panel joins cleaning by
    // property + checkout date, so keep those records even in a monthly view.
    const linkedCheckouts = new Map<string, { propertyId: string; date: string }>();
    for (const stay of [
      ...events.filter(event => event.type === 'reservation').map(event => ({ propertyId: event.propertyId, date: event.endDate })),
      ...bookings.map(booking => ({ propertyId: booking.propertyId, date: booking.checkOut })),
    ]) {
      if (stay.date < rangeFrom || stay.date > rangeTo) linkedCheckouts.set(`${stay.propertyId}:${stay.date}`, stay);
    }
    const cleanings = await timed('cleanings', () => prisma.cleaning.findMany({
      where: { ...pidFilter, OR: [{ date: { gte: rangeFrom, lte: rangeTo } }, ...linkedCheckouts.values()] },
      select: { id: true, propertyId: true, date: true, cleanerId: true, status: true, supplies: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    }));
    return { events, bookings, cleanings };
  })();
  const [{ events, bookings, cleanings }, cleaners] = await Promise.all([
    staysAndCleanings,
    timed('assignees', () => listAssignees(auth)),
  ]);
  timings.queries = performance.now() - tQueries;

  const channelMap: Record<string, string> = {};
  for (const p of properties) {
    for (const ch of p.channels) channelMap[ch.name || ch.id] = ch.name || ch.id;
  }

  timings.total = performance.now() - t0;
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
    { headers: headers() },
  );
}, { serverTiming: true });
