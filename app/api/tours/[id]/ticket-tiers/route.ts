import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, authorizeTour } from '@/lib/auth';

interface TierWritable {
  label?: string;
  price?: number;
  notes?: string | null;
  sortOrder?: number;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tiers = await prisma.tourTicketTier.findMany({
      where: { tourId: id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return NextResponse.json(
      tiers.map(t => ({
        id: t.id,
        label: t.label,
        price: Number(t.price),
        notes: t.notes,
        sortOrder: t.sortOrder,
      })),
    );
  } catch (e) {
    console.error('[tours/:id/ticket-tiers] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const owned = await authorizeTour(id, auth.session.userId, { isAdmin: auth.isAdmin });
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json() as TierWritable;
    if (!body.label || typeof body.label !== 'string') {
      return NextResponse.json({ error: 'label은 필수입니다.' }, { status: 400 });
    }
    if (body.price === undefined || body.price === null) {
      return NextResponse.json({ error: 'price는 필수입니다.' }, { status: 400 });
    }
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: 'price 가 올바르지 않습니다.' }, { status: 400 });
    }

    const tier = await prisma.tourTicketTier.create({
      data: {
        tourId: id,
        label: body.label.trim(),
        price,
        notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
      },
    });
    return NextResponse.json(tier, { status: 201 });
  } catch (e) {
    console.error('[tours/:id/ticket-tiers] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as { tierId?: string } & TierWritable;
    if (!body.tierId) return NextResponse.json({ error: 'tierId는 필수입니다.' }, { status: 400 });

    const tier = await prisma.tourTicketTier.findUnique({
      where: { id: body.tierId },
      select: { tourId: true },
    });
    if (!tier) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const owned = await authorizeTour(tier.tourId, auth.session.userId, { isAdmin: auth.isAdmin });
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const data: TierWritable = {};
    if (body.label !== undefined) data.label = String(body.label).trim();
    if (body.price !== undefined) {
      const p = Number(body.price);
      if (!Number.isFinite(p) || p < 0) {
        return NextResponse.json({ error: 'price 가 올바르지 않습니다.' }, { status: 400 });
      }
      data.price = p;
    }
    if (body.notes !== undefined) {
      data.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    }
    if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
      data.sortOrder = Number(body.sortOrder);
    }

    const updated = await prisma.tourTicketTier.update({ where: { id: body.tierId }, data });
    return NextResponse.json(updated);
  } catch (e) {
    console.error('[tours/:id/ticket-tiers] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const tierId = searchParams.get('tierId');
    if (!tierId) return NextResponse.json({ error: 'tierId는 필수입니다.' }, { status: 400 });

    const tier = await prisma.tourTicketTier.findUnique({
      where: { id: tierId },
      select: { tourId: true },
    });
    if (!tier) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const owned = await authorizeTour(tier.tourId, auth.session.userId, { isAdmin: auth.isAdmin });
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    await prisma.tourTicketTier.delete({ where: { id: tierId } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[tours/:id/ticket-tiers] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
