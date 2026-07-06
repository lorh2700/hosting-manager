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

    const apps = await prisma.cleaningApplication.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        cleaning: { select: { date: true } },
      },
    });
    // Flatten cleaning.date onto the row as `cleaningDate` so the admin
    // page (and any other consumer) can show the schedule date directly.
    return NextResponse.json(
      apps.map(a => ({
        ...a,
        cleaningDate: a.cleaning?.date ?? null,
      })),
    );
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
        id: true,
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

    if (isCleaner) {
      if (cleaning.cleanerId) {
        return NextResponse.json({ error: '이미 다른 담당자에게 배정된 청소입니다.' }, { status: 400 });
      }
      // 동일 (propertyId, date) 슬롯에 배정된 sibling 행이 있으면 이 미배정
      // 행은 유령 잔재 — 신청 차단해 이중 배정 방지.
      const siblingClaimed = await prisma.cleaning.findFirst({
        where: {
          propertyId: cleaning.propertyId,
          date: cleaning.date,
          cleanerId: { not: null },
          id: { not: cleaning.id },
        },
        select: { id: true },
      });
      if (siblingClaimed) {
        return NextResponse.json(
          { error: '이 날짜의 청소는 이미 다른 담당자에게 배정되었습니다.' },
          { status: 400 },
        );
      }
      if (scopedIds.length > 0 && !scopedIds.includes(cleaning.propertyId)) {
        return NextResponse.json({ error: '이 지점의 청소는 신청할 수 없습니다.' }, { status: 403 });
      }
    }

    // Resolve User.id → Cleaner.id (required for FK on cleanings.cleaner_id)
    const cleaner = await prisma.cleaner.findUnique({
      where: { userId: auth.session.userId },
      select: { id: true, name: true },
    });
    if (!cleaner) {
      return NextResponse.json(
        { error: '청소 담당자 프로필이 없습니다. 관리자에게 등록을 요청하세요.' },
        { status: 422 },
      );
    }

    // Prevent duplicate active applications from the same cleaner.
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

    // Atomic: claim the cleaning if still unassigned + record the application
    // as pre-approved. updateMany returns count=0 when another cleaner won
    // the race (or row was reassigned in the meantime).
    const now = new Date();

    const txResult = await prisma.$transaction(async (tx) => {
      const claim = await tx.cleaning.updateMany({
        where: { id: cleaning.id, cleanerId: null },
        data: {
          cleanerId: cleaner.id,
          isOpen: false,
          assignmentType: 'applied',
        },
      });
      if (claim.count === 0) return null;

      const created = await tx.cleaningApplication.create({
        data: {
          cleaningId: cleaning.id,
          propertyId: cleaning.propertyId,
          applicantId: auth.session.userId,
          applicantName: typeof body.applicantName === 'string' && body.applicantName.trim()
            ? body.applicantName.trim()
            : (cleaner.name ?? null),
          status: 'approved',
          processedAt: now,
          processedBy: auth.session.userId,
        },
        select: { id: true },
      });
      return created;
    });

    if (!txResult) {
      return NextResponse.json(
        { error: '동시 신청이 발생했습니다. 다른 담당자가 먼저 배정되었습니다.' },
        { status: 409 },
      );
    }
    const createdApp = txResult;

    // Notify host — the message is "X가 청소를 맡았습니다", not pending review.
    notifyHostOfCleaningApplication({
      hostPhone: cleaning.property?.owner?.phone ?? null,
      hostName: cleaning.property?.owner?.displayName
        ?? cleaning.property?.owner?.email
        ?? '호스트',
      cleanerName: (typeof body.applicantName === 'string' && body.applicantName.trim())
        || cleaner.name
        || '청소담당자',
      propertyName: cleaning.property?.name ?? '숙소',
      date: cleaning.date,
      applicationId: createdApp.id,
    }).catch(err => console.error('[cleaning-applications] notify failed:', err));

    return NextResponse.json({ ok: true, applicationId: createdApp.id }, { status: 201 });
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
