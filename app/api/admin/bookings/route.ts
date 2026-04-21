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
      select: { id: true, name: true, beds24PropId: true },
      orderBy: { createdAt: 'desc' },
    });

    const propertyIds = properties.map(p => p.id);
    if (propertyIds.length === 0) {
      return NextResponse.json({ properties: [], bookings: [], events: [] });
    }

    const pidFilter = { propertyId: { in: propertyIds } };

    const [bookings, events] = await Promise.all([
      prisma.booking.findMany({
        where: pidFilter,
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      prisma.event.findMany({
        where: { ...pidFilter, type: 'reservation' },
        orderBy: { startDate: 'asc' },
        take: 2000,
      }),
    ]);

    return NextResponse.json({ properties, bookings, events });
  } catch (e) {
    console.error('[admin/bookings] GET error:', e);
    const message = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: string })?.code;
    return NextResponse.json({ error: '서버 오류가 발생했습니다.', message, code }, { status: 500 });
  }
}
