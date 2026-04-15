import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';

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

    // All data queries in parallel (was 2 sequential rounds before)
    const [events, bookings, cleanings, cleaners, unreadMessages, pendingSupplies, openIssues] = await Promise.all([
      prisma.event.findMany({
        where: { propertyId: { in: propIds }, type: 'reservation' },
        select: { id: true, propertyId: true, title: true, startDate: true, endDate: true, description: true },
      }),
      prisma.booking.findMany({
        where: { propertyId: { in: propIds }, status: 'confirmed' },
        select: { id: true, propertyId: true, name: true, checkIn: true, checkOut: true, phone: true, email: true },
      }),
      prisma.cleaning.findMany({
        where: { propertyId: { in: propIds } },
        select: { propertyId: true, date: true, cleanerId: true, status: true },
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
        return {
          id: e.id, propertyId: e.propertyId, propertyName: propsMap[e.propertyId] || '',
          title: e.title || '', start: e.startDate, end: e.endDate,
          phone: phoneMatch?.[1]?.trim(), email: emailMatch?.[1]?.trim(),
        };
      }),
      ...bookings.map(b => ({
        id: b.id, propertyId: b.propertyId, propertyName: propsMap[b.propertyId] || '',
        title: b.name || '', start: b.checkIn, end: b.checkOut,
        phone: b.phone || undefined, email: b.email || undefined,
      })),
    ];

    const seen = new Set<string>();
    const unique = reservations.filter(r => {
      const key = `${r.propertyId}_${r.start}_${r.end}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    const cleaningsMap = Object.fromEntries(
      cleanings.map(c => [`${c.propertyId}_${c.date}`, { cleanerId: c.cleanerId, status: c.status }])
    );

    return NextResponse.json({
      properties: propIds.length,
      propsMap,
      reservations: unique,
      cleaningsMap,
      cleanersMap,
      unreadMessages,
      pendingSupplies,
      openIssues,
    });
  } catch (e) {
    console.error('[dashboard] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
