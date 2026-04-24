import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const propertyWhere = auth.isAdmin ? {} : { id: { in: auth.propertyIds! } };

    // Date range: 2 months back ~ 13 months forward
    const now = new Date();
    const rangeFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1)
      .toISOString().split('T')[0];
    const rangeTo = new Date(now.getFullYear(), now.getMonth() + 13, 0)
      .toISOString().split('T')[0];

    const properties = await prisma.property.findMany({
      where: propertyWhere,
      select: {
        id: true, name: true, doorPassword: true,
        addressUrl: true, roomReadyMessage: true,
        channels: { select: { id: true, name: true } },
      },
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
        where: { ...pidFilter, endDate: { gte: rangeFrom }, startDate: { lte: rangeTo } },
        select: {
          id: true, propertyId: true, channelId: true, source: true,
          title: true, startDate: true, endDate: true, type: true, description: true,
          tags: true, originalUid: true,
        },
        orderBy: { startDate: 'asc' },
      }),
      prisma.booking.findMany({
        where: { ...pidFilter, status: 'confirmed', checkOut: { gte: rangeFrom } },
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
      prisma.cleaner.findMany({
        select: { id: true, name: true, phone: true },
      }),
      prisma.supplyTodo.findMany({
        where: pidFilter,
        select: { id: true, propertyId: true, date: true, text: true, done: true, createdAt: true },
      }),
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
    const message = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: string })?.code;
    return NextResponse.json({ error: '서버 오류가 발생했습니다.', message, code }, { status: 500 });
  }
}
