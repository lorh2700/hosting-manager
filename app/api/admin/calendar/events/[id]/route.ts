import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';

type RouteContext = { params: Promise<{ id: string }> };

function forbidden() {
  return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
}

export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    const body = await req.json();

    const existing = await prisma.event.findUnique({
      where: { id },
      select: { id: true, propertyId: true },
    });
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

    if (!auth.isAdmin && !(auth.propertyIds ?? []).includes(existing.propertyId)) {
      return forbidden();
    }

    const data: Record<string, unknown> = {};
    if (Array.isArray(body.tags)) {
      data.tags = (body.tags as unknown[])
        .map(t => typeof t === 'string' ? t.trim() : '')
        .filter((t): t is string => t.length > 0 && t.length <= 40)
        .slice(0, 20);
    }
    if (typeof body.title === 'string') data.title = body.title.slice(0, 200);
    if (typeof body.description === 'string') data.description = body.description.slice(0, 2000);

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '업데이트할 필드가 없습니다.' }, { status: 400 });
    }

    const updated = await prisma.event.update({
      where: { id },
      data,
      select: { id: true, tags: true, title: true, description: true },
    });

    return NextResponse.json(updated);
  } catch (e) {
    console.error('[events PATCH] error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
