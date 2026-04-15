import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');
    const propertyIds = searchParams.get('propertyIds')?.split(',').filter(Boolean);

    const where: Record<string, unknown> = {};
    if (eventId) where.eventId = eventId;
    if (propertyIds?.length) where.propertyId = { in: propertyIds };

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json(messages);
  } catch (e) {
    console.error('[messages] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.content || !body.sender) {
      return NextResponse.json({ error: 'content, sender는 필수입니다.' }, { status: 400 });
    }

    const message = await prisma.message.create({ data: body });
    return NextResponse.json(message, { status: 201 });
  } catch (e) {
    console.error('[messages] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { id, ids, ...data } = body;

    if (ids && Array.isArray(ids)) {
      await prisma.message.updateMany({ where: { id: { in: ids } }, data });
      return NextResponse.json({ success: true });
    }

    if (id) {
      const msg = await prisma.message.update({ where: { id }, data });
      return NextResponse.json(msg);
    }

    return NextResponse.json({ error: 'id 또는 ids는 필수입니다.' }, { status: 400 });
  } catch (e) {
    console.error('[messages] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
