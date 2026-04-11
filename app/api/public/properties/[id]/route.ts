import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const property = await prisma.property.findUnique({ where: { id } });
    if (!property) {
      return new NextResponse('Property not found', { status: 404 });
    }

    // Fetch synced channel events
    const events = await prisma.event.findMany({
      where: { propertyId: id },
      select: { startDate: true, endDate: true, type: true },
    });
    const channelDates = events.map(e => ({
      start: e.startDate,
      end: e.endDate,
      type: e.type,
    }));

    // Fetch confirmed direct bookings
    const bookings = await prisma.booking.findMany({
      where: { propertyId: id, status: 'confirmed' },
      select: { checkIn: true, checkOut: true },
    });
    const bookingDates = bookings.map(b => ({
      start: b.checkIn,
      end: b.checkOut,
      type: 'reservation',
    }));

    return NextResponse.json({
      id: property.id,
      name: property.name,
      timezone: property.timezone,
      permit: null,
      imageUrl: null,
      images: [],
      description: property.description ?? null,
      checkInTime: null,
      checkOutTime: null,
      maxGuests: property.maxGuests ?? null,
      region: null,
      bookedDates: [...channelDates, ...bookingDates],
    });
  } catch (error) {
    console.error('Failed to fetch property:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
