import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { properties: true },
  });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isAdmin = ['super_admin', 'admin'].includes(user.role);
  const propIds = isAdmin
    ? (await prisma.property.findMany({ select: { id: true } })).map(p => p.id)
    : user.properties.map(p => p.propertyId);

  const properties = await prisma.property.findMany({
    where: { id: { in: propIds } },
    select: { id: true, name: true },
  });
  const propsMap = Object.fromEntries(properties.map(p => [p.id, p.name]));

  if (propIds.length === 0) {
    return NextResponse.json({ properties: 0, dayGroups: [], unreadMessages: 0, pendingSupplies: 0, openIssues: 0 });
  }

  // Events + bookings
  const [events, bookings, cleanings, cleaners] = await Promise.all([
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
    isAdmin
      ? prisma.cleaner.findMany({ select: { id: true, name: true } })
      : prisma.cleaner.findMany({ where: { ownerId: session.userId }, select: { id: true, name: true } }),
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

  // Dedup
  const seen = new Set<string>();
  const unique = reservations.filter(r => {
    const key = `${r.propertyId}_${r.start}_${r.end}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  const cleaningsMap = Object.fromEntries(
    cleanings.map(c => [`${c.propertyId}_${c.date}`, { cleanerId: c.cleanerId, status: c.status }])
  );

  // Action counts
  const [unreadMessages, pendingSupplies, openIssues] = await Promise.all([
    prisma.message.count({ where: { sender: 'guest', read: false } }),
    prisma.supplyTodo.count({ where: { done: false } }),
    prisma.cleaningIssue.count({ where: { status: { in: ['open', 'in_progress'] } } }),
  ]);

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
}
