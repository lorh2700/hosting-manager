import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const tours = await prisma.tour.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        slug: true,
        category: true,
        description: true,
        meetingPoint: true,
        durationMin: true,
        basePrice: true,
        maxGroupSize: true,
        images: true,
      },
    });
    return NextResponse.json(
      tours.map(t => ({
        ...t,
        basePrice: t.basePrice ? Number(t.basePrice) : null,
      })),
    );
  } catch (e) {
    console.error('[public/tours] GET error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
