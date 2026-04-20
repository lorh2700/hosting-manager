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
    const isCleaner = auth.user.role === 'cleaner';

    if (auth.isAdmin) {
      if (requestedPropertyIds?.length) where.propertyId = { in: requestedPropertyIds };
    } else if (isCleaner) {
      // Cleaners only see their own applications, regardless of property assignment.
      where.applicantId = auth.session.userId;
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

    const apps = await prisma.cleaningApplication.findMany({ where, orderBy: { createdAt: 'desc' } });
    return NextResponse.json(apps);
  } catch (e) {
    console.error('[cleaning-applications] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.cleaningId) {
      return NextResponse.json({ error: 'cleaningId는 필수입니다.' }, { status: 400 });
    }

    const cleaning = await prisma.cleaning.findUnique({
      where: { id: body.cleaningId },
      select: { propertyId: true, isOpen: true },
    });
    if (!cleaning) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const isCleaner = auth.user.role === 'cleaner';
    const scopedIds = auth.propertyIds ?? [];
    if (!auth.isAdmin && !isCleaner && !scopedIds.includes(cleaning.propertyId)) {
      return forbidden();
    }
    // Cleaners can only apply to cleanings that are still open,
    // and only within their admin-assigned property scope (if any).
    if (isCleaner) {
      if (!cleaning.isOpen) {
        return NextResponse.json({ error: '이미 마감된 청소입니다.' }, { status: 400 });
      }
      if (scopedIds.length > 0 && !scopedIds.includes(cleaning.propertyId)) {
        return NextResponse.json({ error: '이 지점의 청소는 신청할 수 없습니다.' }, { status: 403 });
      }
    }

    const app = await prisma.cleaningApplication.create({
      data: { ...body, propertyId: cleaning.propertyId },
    });
    return NextResponse.json(app, { status: 201 });
  } catch (e) {
    console.error('[cleaning-applications] POST error:', e);
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

    const target = await prisma.cleaningApplication.findUnique({
      where: { id },
      select: { propertyId: true, applicantId: true },
    });
    if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // Non-admins may only mutate their own applications
    const isOwnApplication = target.applicantId === auth.session.userId;
    if (!auth.isAdmin) {
      if (!(auth.propertyIds ?? []).includes(target.propertyId)) return forbidden();
      if (!isOwnApplication) return forbidden();
    }

    const app = await prisma.cleaningApplication.update({ where: { id }, data });
    return NextResponse.json(app);
  } catch (e) {
    console.error('[cleaning-applications] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
