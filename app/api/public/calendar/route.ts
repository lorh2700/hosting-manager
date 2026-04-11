import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const properties = await prisma.property.findMany({
      select: { id: true, name: true, doorPassword: true, addressUrl: true, roomReadyMessage: true },
      orderBy: { createdAt: 'asc' },
    });

    const propertyIds = properties.map(p => p.id);
    if (propertyIds.length === 0) {
      return NextResponse.json({ properties: [], events: [], bookings: [], cleanings: [], cleaners: [] });
    }

    // Fetch channels for channel map
    const channels = await prisma.propertyChannel.findMany({
      where: { propertyId: { in: propertyIds } },
      select: { name: true },
    });

    const [events, bookings, cleanings, cleaners, supplyTodos] = await Promise.all([
      prisma.event.findMany({
        where: { propertyId: { in: propertyIds } },
        select: {
          id: true, propertyId: true, channelId: true, source: true,
          title: true, startDate: true, endDate: true, type: true, description: true,
        },
      }),
      prisma.booking.findMany({
        where: { propertyId: { in: propertyIds }, status: 'confirmed' },
        select: {
          id: true, propertyId: true, name: true, email: true, guests: true,
          checkIn: true, checkOut: true,
        },
      }),
      prisma.cleaning.findMany({
        where: { propertyId: { in: propertyIds } },
        select: {
          id: true, propertyId: true, date: true, cleanerId: true, status: true, supplies: true,
        },
      }),
      prisma.cleaner.findMany({
        select: { id: true, name: true, phone: true },
      }),
      prisma.supplyTodo.findMany({
        where: { propertyId: { in: propertyIds } },
        select: { id: true, propertyId: true, date: true, text: true, done: true, createdAt: true },
      }),
    ]);

    // Map events to use start/end for client compatibility
    const mappedEvents = events.map(e => ({
      id: e.id,
      propertyId: e.propertyId,
      channelId: e.channelId ?? '',
      source: e.source ?? undefined,
      title: e.title ?? '',
      start: e.startDate ?? '',
      end: e.endDate ?? '',
      type: e.type ?? 'reservation',
      description: e.description ?? undefined,
    }));

    const channelMap: Record<string, string> = {};
    channels.forEach(c => { channelMap[c.name] = c.name; });

    return NextResponse.json({
      properties,
      channelMap,
      events: mappedEvents,
      bookings: bookings.map(b => ({
        id: b.id,
        propertyId: b.propertyId,
        name: b.name,
        email: b.email,
        guests: b.guests,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
      })),
      cleanings,
      cleaners,
      supplyTodos,
    });
  } catch (err) {
    console.error('Public calendar API error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
