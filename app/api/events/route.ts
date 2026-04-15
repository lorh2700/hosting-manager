import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const propertyIds = searchParams.get('propertyIds')?.split(',').filter(Boolean);
    const type = searchParams.get('type');
    const limit = Math.min(Number(searchParams.get('limit')) || 1000, 2000);
    const offset = Number(searchParams.get('offset')) || 0;

    const where: Record<string, unknown> = {};
    if (propertyIds?.length) where.propertyId = { in: propertyIds };
    if (type) where.type = type;

    const events = await prisma.event.findMany({
      where, orderBy: { startDate: 'asc' }, take: limit, skip: offset,
    });
    return NextResponse.json(events);
  } catch (e) {
    console.error('[events] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.propertyId) {
      return NextResponse.json({ error: 'propertyId는 필수입니다.' }, { status: 400 });
    }

    const event = await prisma.event.create({
      data: {
        propertyId: body.propertyId,
        channelId: body.channelId,
        source: body.source,
        title: body.title,
        startDate: body.startDate || body.start,
        endDate: body.endDate || body.end,
        type: body.type || 'reservation',
        originalUid: body.originalUid,
        description: body.description,
      },
    });
    return NextResponse.json(event, { status: 201 });
  } catch (e) {
    console.error('[events] POST error:', e);
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

    if (data.start) { data.startDate = data.start; delete data.start; }
    if (data.end) { data.endDate = data.end; delete data.end; }

    const event = await prisma.event.update({ where: { id }, data });
    return NextResponse.json(event);
  } catch (e) {
    console.error('[events] PUT error:', e);
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

    await prisma.event.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[events] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
