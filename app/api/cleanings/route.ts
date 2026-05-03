import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';
import { notifyCleaningAssigned, notifyCleaningCancelled } from '@/lib/notify';

async function notifyAssignmentByCleaningId(cleaningId: string) {
  try {
    const cleaning = await prisma.cleaning.findUnique({
      where: { id: cleaningId },
      include: {
        property: { select: { name: true } },
        cleaner: { select: { name: true, phone: true, publicToken: true } },
      },
    });
    if (!cleaning?.cleaner?.phone || !cleaning.cleaner.publicToken) return;

    const result = await notifyCleaningAssigned({
      cleanerPhone: cleaning.cleaner.phone,
      cleanerName: cleaning.cleaner.name,
      cleanerToken: cleaning.cleaner.publicToken,
      items: [
        {
          propertyName: cleaning.property?.name ?? '숙소',
          date: cleaning.date,
        },
      ],
    });
    if (result && !result.ok) {
      console.error('[cleanings] notify failed:', result.error);
    }
  } catch (e) {
    console.error('[cleanings] notify error:', e);
  }
}

async function notifyCancellationToCleaner(opts: {
  cleanerId: string;
  propertyId: string;
  date: string;
  reason: 'deleted' | 'reassigned';
}) {
  try {
    const [cleaner, property] = await Promise.all([
      prisma.cleaner.findUnique({
        where: { id: opts.cleanerId },
        select: { name: true, phone: true },
      }),
      prisma.property.findUnique({
        where: { id: opts.propertyId },
        select: { name: true },
      }),
    ]);
    if (!cleaner?.phone) return;

    const result = await notifyCleaningCancelled({
      cleanerPhone: cleaner.phone,
      cleanerName: cleaner.name,
      propertyName: property?.name ?? '숙소',
      date: opts.date,
      reason: opts.reason,
    });
    if (result && !result.ok) {
      console.error('[cleanings] cancel notify failed:', result.error);
    }
  } catch (e) {
    console.error('[cleanings] cancel notify error:', e);
  }
}

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
    const isOpen = searchParams.get('isOpen');

    const where: Record<string, unknown> = {};
    const isCleaner = auth.user.role === 'cleaner';
    const scopedIds = auth.propertyIds ?? [];

    if (auth.isAdmin) {
      if (requestedPropertyIds?.length) where.propertyId = { in: requestedPropertyIds };
    } else if (isCleaner && isOpen === 'true') {
      // Cleaners browsing open cleanings:
      //   - if admin scoped them to properties, restrict to those
      //   - otherwise show everything so they can apply broadly
      if (scopedIds.length > 0) {
        const ids = requestedPropertyIds?.length
          ? requestedPropertyIds.filter(id => scopedIds.includes(id))
          : scopedIds;
        if (ids.length === 0) return NextResponse.json([]);
        where.propertyId = { in: ids };
      } else if (requestedPropertyIds?.length) {
        where.propertyId = { in: requestedPropertyIds };
      }
    } else {
      if (scopedIds.length === 0) return NextResponse.json([]);
      const ids = requestedPropertyIds?.length
        ? requestedPropertyIds.filter(id => scopedIds.includes(id))
        : scopedIds;
      if (ids.length === 0) return NextResponse.json([]);
      where.propertyId = { in: ids };
    }

    if (status) where.status = status;
    if (isOpen === 'true') {
      // "신청가능" = whoever has no cleaner assigned. We deliberately do
      // NOT also gate on the `isOpen` flag — admins frequently leave it
      // unset on manually-created cleanings, but those should still be
      // applicable. The flag remains in the DB for legacy data only.
      where.cleanerId = null;
    }

    const cleanings = await prisma.cleaning.findMany({
      where,
      include: { cleaner: true, applications: true },
      orderBy: { date: 'desc' },
    });
    return NextResponse.json(cleanings);
  } catch (e) {
    console.error('[cleanings] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.propertyId || !body.date) {
      return NextResponse.json({ error: 'propertyId, date는 필수입니다.' }, { status: 400 });
    }

    if (!auth.isAdmin && !(auth.propertyIds ?? []).includes(body.propertyId)) {
      return forbidden();
    }

    // Assigning a cleaner directly closes the open-application slot.
    if (body.cleanerId && body.isOpen !== false) {
      body.isOpen = false;
    }

    const cleaning = await prisma.cleaning.create({ data: body });

    if (cleaning.cleanerId) {
      await notifyAssignmentByCleaningId(cleaning.id);
    }

    return NextResponse.json(cleaning, { status: 201 });
  } catch (e) {
    console.error('[cleanings] POST error:', e);
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

    if ('cleanerId' in data && data.cleanerId === '') data.cleanerId = null;

    // Whenever a cleaner is being assigned, the slot is no longer "open
    // for application". Conversely, clearing the cleaner doesn't auto-open
    // — that's an explicit admin action via the cleaning-requests page.
    if ('cleanerId' in data && data.cleanerId && !('isOpen' in data)) {
      data.isOpen = false;
    }

    const before = await prisma.cleaning.findUnique({
      where: { id },
      select: { cleanerId: true, propertyId: true, date: true },
    });
    if (!before) return NextResponse.json({ error: 'not found' }, { status: 404 });

    if (!auth.isAdmin && !(auth.propertyIds ?? []).includes(before.propertyId)) {
      return forbidden();
    }

    const cleaning = await prisma.cleaning.update({ where: { id }, data });

    const cleanerChanged = 'cleanerId' in data && cleaning.cleanerId !== before.cleanerId;
    if (cleanerChanged && before.cleanerId) {
      // Previous cleaner is no longer on the hook — tell them.
      await notifyCancellationToCleaner({
        cleanerId: before.cleanerId,
        propertyId: before.propertyId,
        date: before.date,
        reason: 'reassigned',
      });
    }
    if (cleanerChanged && cleaning.cleanerId) {
      await notifyAssignmentByCleaningId(cleaning.id);
    }

    return NextResponse.json(cleaning);
  } catch (e) {
    console.error('[cleanings] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const target = await prisma.cleaning.findUnique({
      where: { id },
      select: { propertyId: true, cleanerId: true, date: true },
    });
    if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 });

    if (!auth.isAdmin && !(auth.propertyIds ?? []).includes(target.propertyId)) {
      return forbidden();
    }

    await prisma.cleaning.delete({ where: { id } });

    if (target.cleanerId) {
      await notifyCancellationToCleaner({
        cleanerId: target.cleanerId,
        propertyId: target.propertyId,
        date: target.date,
        reason: 'deleted',
      });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[cleanings] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
