import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';
import { notifyHostOfCleaningApplication } from '@/lib/notify';

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
      select: {
        propertyId: true,
        cleanerId: true,
        date: true,
        property: {
          select: {
            name: true,
            owner: { select: { displayName: true, email: true, phone: true } },
          },
        },
      },
    });
    if (!cleaning) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const isCleaner = auth.user.role === 'cleaner';
    const scopedIds = auth.propertyIds ?? [];
    if (!auth.isAdmin && !isCleaner && !scopedIds.includes(cleaning.propertyId)) {
      return forbidden();
    }
    // Cleaners can apply as long as nobody is assigned yet, and only within
    // their admin-assigned property scope (if any).
    if (isCleaner) {
      if (cleaning.cleanerId) {
        return NextResponse.json({ error: '이미 다른 담당자에게 배정된 청소입니다.' }, { status: 400 });
      }
      if (scopedIds.length > 0 && !scopedIds.includes(cleaning.propertyId)) {
        return NextResponse.json({ error: '이 지점의 청소는 신청할 수 없습니다.' }, { status: 403 });
      }
    }

    // Prevent duplicate active applications from the same cleaner for the
    // same cleaning (UI already disables the button, but defend the API).
    const existing = await prisma.cleaningApplication.findFirst({
      where: {
        cleaningId: body.cleaningId,
        applicantId: auth.session.userId,
        status: { in: ['pending', 'approved'] },
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: '이미 신청한 청소입니다.' }, { status: 409 });
    }

    const app = await prisma.cleaningApplication.create({
      data: { ...body, propertyId: cleaning.propertyId },
    });

    // Best-effort notify the property owner — never fail the request because
    // notification couldn't be sent.
    notifyHostOfCleaningApplication({
      hostPhone: cleaning.property?.owner?.phone ?? null,
      hostName: cleaning.property?.owner?.displayName
        ?? cleaning.property?.owner?.email
        ?? '호스트',
      cleanerName: body.applicantName ?? '청소담당자',
      propertyName: cleaning.property?.name ?? '숙소',
      date: cleaning.date,
      applicationId: app.id,
    }).catch(err => console.error('[cleaning-applications] notify failed:', err));

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
