import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const tour = await prisma.tour.findUnique({
      where: { id },
      include: {
        operator: true,
        schedules: { orderBy: [{ date: 'asc' }, { startTime: 'asc' }] },
        durationOptions: { orderBy: [{ sortOrder: 'asc' }, { durationMin: 'asc' }] },
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
    });
  } catch (e) {
    console.error('[tours/:id] GET error:', e);
    const detail = e instanceof Error
      ? { message: e.message, code: (e as { code?: string }).code }
      : { message: String(e) };
    return NextResponse.json({ error: '서버 오류가 발생했습니다.', detail }, { status: 500 });
  }
}
