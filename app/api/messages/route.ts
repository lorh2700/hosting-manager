import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';

function forbidden() {
  return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
}

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');
    const requestedPropertyIds = searchParams.get('propertyIds')?.split(',').filter(Boolean);

    const where: Record<string, unknown> = {};
    if (eventId) where.eventId = eventId;

    if (auth.isAdmin) {
      if (requestedPropertyIds?.length) where.propertyId = { in: requestedPropertyIds };
    } else {
      const allowed = auth.propertyIds ?? [];
      if (allowed.length === 0) return NextResponse.json([]);
      const ids = requestedPropertyIds?.length
        ? requestedPropertyIds.filter(id => allowed.includes(id))
        : allowed;
      if (ids.length === 0) return NextResponse.json([]);
      where.propertyId = { in: ids };
    }

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
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.text || !body.sender) {
      return NextResponse.json({ error: 'text, sender는 필수입니다.' }, { status: 400 });
    }

    if (body.propertyId && !auth.isAdmin && !(auth.propertyIds ?? []).includes(body.propertyId)) {
      return forbidden();
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
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { id, ids, ...data } = body;

    if (ids && Array.isArray(ids)) {
      if (!auth.isAdmin) {
        const allowed = auth.propertyIds ?? [];
        const targets = await prisma.message.findMany({
          where: { id: { in: ids } },
          select: { id: true, propertyId: true },
        });
        const disallowed = targets.some(
          t => !t.propertyId || !allowed.includes(t.propertyId)
        );
        if (disallowed) return forbidden();
      }
      await prisma.message.updateMany({ where: { id: { in: ids } }, data });
      return NextResponse.json({ success: true });
    }

    if (id) {
      const target = await prisma.message.findUnique({
        where: { id },
        select: { propertyId: true },
      });
      if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 });

      if (!auth.isAdmin) {
        const allowed = auth.propertyIds ?? [];
        if (!target.propertyId || !allowed.includes(target.propertyId)) return forbidden();
      }

      const msg = await prisma.message.update({ where: { id }, data });
      return NextResponse.json(msg);
    }

    return NextResponse.json({ error: 'id 또는 ids는 필수입니다.' }, { status: 400 });
  } catch (e) {
    console.error('[messages] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
