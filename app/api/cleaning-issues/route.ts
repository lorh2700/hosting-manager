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
    const requestedPropertyIds = searchParams.get('propertyIds')?.split(',').filter(Boolean);
    const status = searchParams.get('status');

    const where: Record<string, unknown> = {};

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

    if (status) where.status = status;

    const issues = await prisma.cleaningIssue.findMany({ where, orderBy: { createdAt: 'desc' } });
    return NextResponse.json(issues);
  } catch (e) {
    console.error('[cleaning-issues] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.propertyId || !body.category || !body.description) {
      return NextResponse.json({ error: 'propertyId, category, description은 필수입니다.' }, { status: 400 });
    }

    if (!auth.isAdmin && !(auth.propertyIds ?? []).includes(body.propertyId)) {
      return forbidden();
    }

    const issue = await prisma.cleaningIssue.create({ data: body });
    return NextResponse.json(issue, { status: 201 });
  } catch (e) {
    console.error('[cleaning-issues] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const target = await prisma.cleaningIssue.findUnique({
      where: { id },
      select: { propertyId: true },
    });
    if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 });

    if (!auth.isAdmin && !(auth.propertyIds ?? []).includes(target.propertyId)) {
      return forbidden();
    }

    const issue = await prisma.cleaningIssue.update({ where: { id }, data });
    return NextResponse.json(issue);
  } catch (e) {
    console.error('[cleaning-issues] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
