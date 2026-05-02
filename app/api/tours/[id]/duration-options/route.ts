import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const options = await prisma.tourDurationOption.findMany({
      where: { tourId: id },
      orderBy: [{ sortOrder: 'asc' }, { durationMin: 'asc' }],
    });
    return NextResponse.json(
      options.map(o => ({
        id: o.id,
        label: o.label,
        durationMin: o.durationMin,
        price: Number(o.price),
        sortOrder: o.sortOrder,
      })),
    );
  } catch (e) {
    console.error('[tours/:id/duration-options] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    if (!body.durationMin || body.price === undefined || body.price === null) {
      return NextResponse.json({ error: 'durationMin과 price는 필수입니다.' }, { status: 400 });
    }
    const created = await prisma.tourDurationOption.create({
      data: {
        tourId: id,
        label: body.label?.trim() || null,
        durationMin: Number(body.durationMin),
        price: body.price,
        sortOrder: Number(body.sortOrder ?? 0),
      },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    console.error('[tours/:id/duration-options] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { optionId, label, durationMin, price, sortOrder } = body;
    if (!optionId) return NextResponse.json({ error: 'optionId는 필수입니다.' }, { status: 400 });

    const data: { label?: string | null; durationMin?: number; price?: number; sortOrder?: number } = {};
    if (label !== undefined) data.label = label?.trim() || null;
    if (durationMin !== undefined) data.durationMin = Number(durationMin);
    if (price !== undefined) data.price = Number(price);
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder);

    const updated = await prisma.tourDurationOption.update({ where: { id: optionId }, data });
    return NextResponse.json(updated);
  } catch (e) {
    console.error('[tours/:id/duration-options] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const optionId = searchParams.get('optionId');
    if (!optionId) return NextResponse.json({ error: 'optionId는 필수입니다.' }, { status: 400 });

    const usage = await prisma.tourBooking.count({ where: { durationOptionId: optionId } });
    if (usage > 0) {
      return NextResponse.json(
        { error: `예약(${usage}건)이 있는 코스는 삭제할 수 없습니다. 가격만 수정하세요.` },
        { status: 409 },
      );
    }

    await prisma.tourDurationOption.delete({ where: { id: optionId } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[tours/:id/duration-options] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
