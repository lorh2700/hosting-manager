import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const propertyWhere = auth.isAdmin ? {} : { id: { in: auth.propertyIds! } };

    const properties = await prisma.property.findMany({
      where: propertyWhere,
      include: { channels: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const propertyIds = properties.map(p => p.id);
    if (propertyIds.length === 0) {
      return NextResponse.json({
        properties: [], channelMap: {},
        events: [], bookings: [], cleanings: [], cleaners: [], supplyTodos: [],
      });
    }

    const pidFilter = { propertyId: { in: propertyIds } };

    const [events, bookings, cleanings, cleaners, supplyTodos] = await Promise.all([
      prisma.event.findMany({
        where: pidFilter,
        orderBy: { startDate: 'asc' },
        take: 2000,
      }),
      prisma.booking.findMany({
        where: { ...pidFilter, status: 'confirmed' },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      prisma.cleaning.findMany({
        where: pidFilter,
        include: { cleaner: true, applications: true },
        orderBy: { date: 'desc' },
      }),
      prisma.cleaner.findMany(),
      prisma.supplyTodo.findMany({ where: pidFilter }),
    ]);

    const channelMap: Record<string, string> = {};
    for (const p of properties) {
      for (const ch of p.channels) {
        channelMap[ch.name || ch.id] = ch.name || ch.id;
      }
    }

    return NextResponse.json({
      properties: properties.map(p => ({
        id: p.id, name: p.name, doorPassword: p.doorPassword,
        addressUrl: p.addressUrl, roomReadyMessage: p.roomReadyMessage,
      })),
      channelMap,
      events,
      bookings,
      cleanings,
      cleaners,
      supplyTodos,
    });
  } catch (e) {
    console.error('[admin/calendar] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
