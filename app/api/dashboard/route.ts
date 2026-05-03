import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';
import { addDays, endOfMonth, format, startOfMonth } from 'date-fns';

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const propWhere = auth.isAdmin ? {} : { id: { in: auth.propertyIds! } };

    // Single query for properties (instead of two separate queries)
    const properties = await prisma.property.findMany({
      where: propWhere,
      select: { id: true, name: true },
    });
    const propIds = properties.map(p => p.id);
    const propsMap = Object.fromEntries(properties.map(p => [p.id, p.name]));

    if (propIds.length === 0) {
      return NextResponse.json({ properties: 0, dayGroups: [], unreadMessages: 0, pendingSupplies: 0, openIssues: 0 });
    }

    const now = new Date();
    const rangeStart = format(startOfMonth(now), 'yyyy-MM-dd');
    const weekEndStr = format(addDays(now, 6), 'yyyy-MM-dd');
    const monthEndStr = format(endOfMonth(now), 'yyyy-MM-dd');
    const rangeEnd = weekEndStr > monthEndStr ? weekEndStr : monthEndStr;

    // All data queries in parallel (was 2 sequential rounds before)
    const [events, bookings, cleanings, cleaners, unreadMessages, pendingSupplies, openIssues] = await Promise.all([
      prisma.event.findMany({
        where: {
          propertyId: { in: propIds },
          type: 'reservation',
          startDate: { lte: rangeEnd },
          endDate: { gte: rangeStart },
        },
        select: { id: true, propertyId: true, title: true, startDate: true, endDate: true, description: true, source: true, channelId: true },
      }),
      prisma.booking.findMany({
        where: {
          propertyId: { in: propIds },
          status: 'confirmed',
          checkIn: { lte: rangeEnd },
          checkOut: { gte: rangeStart },
        },
        select: { id: true, propertyId: true, name: true, checkIn: true, checkOut: true, phone: true, email: true, guests: true, source: true },
      }),
      prisma.cleaning.findMany({
        where: {
          propertyId: { in: propIds },
          date: { gte: rangeStart, lte: rangeEnd },
        },
        select: { propertyId: true, date: true, cleanerId: true, status: true, isOpen: true },
      }),
      auth.isAdmin
        ? prisma.cleaner.findMany({ select: { id: true, name: true } })
        : prisma.cleaner.findMany({ where: { ownerId: auth.session.userId }, select: { id: true, name: true } }),
      prisma.message.count({ where: { sender: 'guest', read: false } }),
      prisma.supplyTodo.count({ where: { done: false } }),
      prisma.cleaningIssue.count({ where: { status: { in: ['open', 'in_progress'] } } }),
    ]);

    const cleanersMap = Object.fromEntries(cleaners.map(c => [c.id, c.name]));

    const reservations = [
      ...events.map(e => {
        const desc = e.description || '';
        const phoneMatch = desc.match(/연락처:\s*(.+)/);
        const emailMatch = desc.match(/이메일:\s*(.+)/);
        const adultMatch = desc.match(/성인\s*(\d+)/);
        const childMatch = desc.match(/아동\s*(\d+)/);
        const guests = (adultMatch ? Number(adultMatch[1]) : 0) + (childMatch ? Number(childMatch[1]) : 0);
        const channelMatch = desc.match(/채널:\s*(.+)/);
        const source = e.source || channelMatch?.[1]?.trim() || e.channelId || null;
        return {
          id: e.id, propertyId: e.propertyId, propertyName: propsMap[e.propertyId] || '',
          title: e.title || '', start: e.startDate, end: e.endDate,
          phone: phoneMatch?.[1]?.trim(), email: emailMatch?.[1]?.trim(),
          guests: guests || undefined,
          source,
          dataSource: 'event' as const,
        };
      }),
      ...bookings.map(b => ({
        id: b.id, propertyId: b.propertyId, propertyName: propsMap[b.propertyId] || '',
        title: b.name || '', start: b.checkIn, end: b.checkOut,
        phone: b.phone || undefined, email: b.email || undefined,
        guests: b.guests || undefined,
        source: b.source || 'direct',
        dataSource: 'booking' as const,
      })),
    ];

    const seen = new Set<string>();
    const unique = reservations.filter(r => {
      const key = `${r.propertyId}_${r.start}_${r.end}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    // Multiple cleaning rows can exist for the same property+date (e.g., one
    // auto-created by iCal sync + one admin-assigned). Aggregate so the slot
    // is treated as assigned if ANY row carries a cleanerId.
    const cleaningsMap: Record<string, { cleanerId: string | null; status: string; isOpen: boolean }> = {};
    for (const c of cleanings) {
      const key = `${c.propertyId}_${c.date}`;
      const existing = cleaningsMap[key];
      if (!existing) {
        cleaningsMap[key] = { cleanerId: c.cleanerId, status: c.status, isOpen: c.isOpen };
      } else if (c.cleanerId && !existing.cleanerId) {
        // Prefer the assigned row over an unassigned one for the same slot.
        cleaningsMap[key] = { cleanerId: c.cleanerId, status: c.status, isOpen: c.isOpen };
      } else if (c.isOpen && !existing.cleanerId) {
        existing.isOpen = true;
      }
    }

    return NextResponse.json(
      {
        properties: propIds.length,
        propsMap,
        reservations: unique,
        cleaningsMap,
        cleanersMap,
        unreadMessages,
        pendingSupplies,
        openIssues,
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=15, stale-while-revalidate=120',
        },
      },
    );
  } catch (e) {
    console.error('[dashboard] GET error:', e);
    const message = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: string })?.code;
    return NextResponse.json({ error: '서버 오류가 발생했습니다.', message, code }, { status: 500 });
  }
}
