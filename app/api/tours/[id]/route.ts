import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, authorizeTour } from '@/lib/auth';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const owned = await authorizeTour(id, auth.session.userId, { isAdmin: auth.isAdmin });
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const tour = await prisma.tour.findUnique({
      where: { id },
      include: {
        operator: true,
        schedules: { orderBy: [{ date: 'asc' }, { startTime: 'asc' }] },
        durationOptions: { orderBy: [{ sortOrder: 'asc' }, { durationMin: 'asc' }] },
        ticketTiers: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        _count: { select: { bookings: true } },
      },
    });
    if (!tour) return NextResponse.json({ error: 'not found' }, { status: 404 });

    return NextResponse.json({
      ...tour,
      basePrice: tour.basePrice ? Number(tour.basePrice) : null,
      durationOptions: tour.durationOptions.map(o => ({
        id: o.id,
        label: o.label,
        durationMin: o.durationMin,
        price: Number(o.price),
        sortOrder: o.sortOrder,
      })),
      ticketTiers: tour.ticketTiers.map(t => ({
        id: t.id,
        label: t.label,
        price: Number(t.price),
        notes: t.notes,
        sortOrder: t.sortOrder,
      })),
    });
  } catch (e) {
    console.error('[tours/:id] GET error:', e);
    const detail = e instanceof Error
      ? { message: e.message, code: (e as { code?: string }).code }
      : { message: String(e) };
    return NextResponse.json({ error: '서버 오류가 발생했습니다.', detail }, { status: 500 });
  }
}
