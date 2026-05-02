import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, authorizeTour } from '@/lib/auth';
import { uniqueSlug } from '@/lib/slug';

// Allowed fields for client-supplied input — guards against mass assignment.
const TOUR_WRITABLE_FIELDS = [
  'title', 'slug', 'category', 'description', 'meetingPoint',
  'durationMin', 'basePrice', 'maxGroupSize', 'operatorId',
  'images', 'isActive',
] as const;

type TourWritable = Partial<Record<typeof TOUR_WRITABLE_FIELDS[number], unknown>>;

function pickWritable(body: Record<string, unknown>): TourWritable {
  const out: TourWritable = {};
  for (const key of TOUR_WRITABLE_FIELDS) {
    if (key in body) out[key] = body[key];
  }
  // Defensive: images must be a string array, not arbitrary
  if ('images' in out && !Array.isArray(out.images)) delete out.images;
  return out;
}

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
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json({ error: 'title은 필수입니다.' }, { status: 400 });
    }

    // If linking to an operator, ensure the user owns it.
    if (body.operatorId) {
      const ok = await prisma.tourOperator.findFirst({
        where: { id: body.operatorId, ...(auth.isAdmin ? {} : { ownerId: auth.session.userId }) },
        select: { id: true },
      });
      if (!ok) return NextResponse.json({ error: '운영업체에 대한 권한이 없습니다.' }, { status: 403 });
    }

    const tour = await prisma.tour.create({
      data: {
        ownerId: auth.session.userId,
        title: body.title,
        slug: typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : uniqueSlug(body.title),
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
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const owned = await authorizeTour(id, auth.session.userId, { isAdmin: auth.isAdmin });
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const data = pickWritable(body);

    // operatorId change → must own the new operator (unless setting to null)
    if (data.operatorId) {
      const ok = await prisma.tourOperator.findFirst({
        where: { id: data.operatorId as string, ...(auth.isAdmin ? {} : { ownerId: auth.session.userId }) },
        select: { id: true },
      });
      if (!ok) return NextResponse.json({ error: '운영업체에 대한 권한이 없습니다.' }, { status: 403 });
    }

    const tour = await prisma.tour.update({
      where: { id },
      data: data as Parameters<typeof prisma.tour.update>[0]['data'],
    });
    return NextResponse.json(tour);
  } catch (e) {
    console.error('[tours] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const owned = await authorizeTour(id, auth.session.userId, { isAdmin: auth.isAdmin });
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
