import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession, getSessionWithUser } from '@/lib/auth';
import { uniqueSlug } from '@/lib/slug';

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const tours = await prisma.tour.findMany({
      where: auth.isAdmin ? undefined : { ownerId: auth.session.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        operator: { select: { id: true, name: true } },
        _count: { select: { schedules: true, bookings: true } },
      },
    });

    return NextResponse.json(
      tours.map(t => ({
        id: t.id,
        title: t.title,
        slug: t.slug,
        category: t.category,
        description: t.description,
        meetingPoint: t.meetingPoint,
        durationMin: t.durationMin,
        basePrice: t.basePrice ? Number(t.basePrice) : null,
        maxGroupSize: t.maxGroupSize,
        images: t.images,
        isActive: t.isActive,
        operator: t.operator,
        operatorId: t.operatorId,
        scheduleCount: t._count.schedules,
        bookingCount: t._count.bookings,
        createdAt: t.createdAt,
      })),
    );
  } catch (e) {
    console.error('[tours] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.title) {
      return NextResponse.json({ error: 'title은 필수입니다.' }, { status: 400 });
    }

    const tour = await prisma.tour.create({
      data: {
        ownerId: session.userId,
        title: body.title,
        slug: body.slug?.trim() || uniqueSlug(body.title),
        category: body.category ?? null,
        description: body.description ?? null,
        meetingPoint: body.meetingPoint ?? null,
        durationMin: body.durationMin ?? null,
        basePrice: body.basePrice ?? null,
        maxGroupSize: body.maxGroupSize ?? null,
        operatorId: body.operatorId ?? null,
        images: Array.isArray(body.images) ? body.images : [],
        isActive: body.isActive ?? true,
      },
    });
    return NextResponse.json(tour, { status: 201 });
  } catch (e) {
    console.error('[tours] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const tour = await prisma.tour.update({ where: { id }, data });
    return NextResponse.json(tour);
  } catch (e) {
    console.error('[tours] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const bookingCount = await prisma.tourBooking.count({ where: { tourId: id } });
    if (bookingCount > 0) {
      return NextResponse.json(
        { error: `예약이 있는 투어는 삭제할 수 없습니다. (${bookingCount}건). 비활성화로 전환하세요.` },
        { status: 409 },
      );
    }

    await prisma.tour.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[tours] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
