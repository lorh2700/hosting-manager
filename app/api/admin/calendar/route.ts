import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';
import { kstYearMonth, monthRange } from '@/lib/dates';

export async function GET(req: Request) {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    timings.auth = Date.now() - t0;

    const propertyWhere = auth.isAdmin ? {} : { id: { in: auth.propertyIds! } };

    // Default range tightened: 1 month back + 2 months forward (= 3mo
    // total). Smaller payload → faster load. Client can request more via
    // ?monthsForward=N when navigating beyond the visible window.
    const url = new URL(req.url);
    const monthsBackParam = Number(url.searchParams.get('monthsBack'));
    const monthsForwardParam = Number(url.searchParams.get('monthsForward'));
    const monthsBack = Number.isFinite(monthsBackParam) && monthsBackParam >= 0 ? monthsBackParam : 1;
    const monthsForward = Number.isFinite(monthsForwardParam) && monthsForwardParam > 0 ? monthsForwardParam : 2;

    // 서버(UTC)가 아니라 한국 시간 기준 월로 계산 — 매월 1일 새벽에 창이 한 달 밀리던 문제.
    const { year, month } = kstYearMonth();
    const rangeFrom = monthRange(year, month - monthsBack).first;
    const rangeTo = monthRange(year, month + monthsForward).last;

    const tProps = Date.now();
    const properties = await prisma.property.findMany({
      where: propertyWhere,
      select: {
        id: true, name: true, doorPassword: true,
        addressUrl: true, roomReadyMessage: true,
        channels: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    timings.properties = Date.now() - tProps;

    const propertyIds = properties.map(p => p.id);
    if (propertyIds.length === 0) {
      return NextResponse.json({
        properties: [], channelMap: {},
        events: [], bookings: [], cleanings: [], cleaners: [],
      });
    }

    const pidFilter = { propertyId: { in: propertyIds } };

    // SupplyTodos moved to a separate endpoint (/api/admin/calendar/supply-todos)
    // so the main calendar grid can render with one fewer parallel query.
    // The supply panel fetches it lazily on its own.
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
        select: {
          id: true, propertyId: true, name: true, email: true,
          guests: true, checkIn: true, checkOut: true,
        },
        orderBy: { checkIn: 'asc' },
      }),
      prisma.cleaning.findMany({
        where: { ...pidFilter, date: { gte: rangeFrom, lte: rangeTo } },
        select: {
          id: true, propertyId: true, date: true,
          cleanerId: true, status: true, supplies: true,
        },
        orderBy: { date: 'desc' },
      }),
      auth.isAdmin
        ? prisma.cleaner.findMany({ select: { id: true, name: true, phone: true } })
        : prisma.cleaner.findMany({
            where: { ownerId: auth.session.userId },
            select: { id: true, name: true, phone: true },
          }),
    ]);
    timings.queries = Date.now() - tQueries;

    const channelMap: Record<string, string> = {};
    for (const p of properties) {
      for (const ch of p.channels) {
        channelMap[ch.name || ch.id] = ch.name || ch.id;
      }
    }

    timings.total = Date.now() - t0;
    if (timings.total > 500) {
      console.warn('[admin/calendar] slow GET', { timings, eventCount: events.length, bookingCount: bookings.length, cleaningCount: cleanings.length });
    }

    return NextResponse.json(
      {
        properties: properties.map(p => ({
          id: p.id, name: p.name, doorPassword: p.doorPassword,
          addressUrl: p.addressUrl, roomReadyMessage: p.roomReadyMessage,
        })),
        channelMap,
        events,
        bookings,
        cleanings,
        cleaners,
        // Empty array — supplyTodos now fetched separately. Field kept for
        // backwards-compat with existing clients.
        supplyTodos: [],
        _timings: process.env.NODE_ENV === 'development' ? timings : undefined,
      },
      {
        headers: {
          // Short revalidating cache: sub-second navigation back to the
          // calendar reuses the cached payload while still picking up
          // fresh state within ~30s.
          'Cache-Control': 'private, max-age=15, stale-while-revalidate=120',
        },
      },
    );
  } catch (e) {
    console.error('[admin/calendar] GET error:', e, { timings });
    const message = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: string })?.code;
    return NextResponse.json({ error: '서버 오류가 발생했습니다.', message, code }, { status: 500 });
  }
}
