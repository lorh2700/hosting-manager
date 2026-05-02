import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, authorizeTour, authorizeTourSchedule } from '@/lib/auth';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const owned = await authorizeTour(id, auth.session.userId, { isAdmin: auth.isAdmin });
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const schedules = await prisma.tourSchedule.findMany({
      where: {
        tourId: id,
        ...(from || to
          ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    return NextResponse.json(schedules);
  } catch (e) {
    console.error('[tours/:id/schedule] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

interface BulkSlot {
  date: string;
  startTime: string;
  capacity: number;
}

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RX = /^\d{2}:\d{2}$/;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const owned = await authorizeTour(id, auth.session.userId, { isAdmin: auth.isAdmin });
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const slots: BulkSlot[] = Array.isArray(body.slots) ? body.slots : [];
    if (slots.length === 0) {
      return NextResponse.json({ error: '추가할 슬롯이 없습니다.' }, { status: 400 });
    }
    // Hard cap to prevent runaway bulk inserts.
    if (slots.length > 1000) {
      return NextResponse.json({ error: '한 번에 최대 1000개까지 등록할 수 있습니다.' }, { status: 400 });
    }
    for (const s of slots) {
      if (typeof s.date !== 'string' || !DATE_RX.test(s.date)) {
        return NextResponse.json({ error: '날짜 형식이 올바르지 않습니다.' }, { status: 400 });
      }
      if (typeof s.startTime !== 'string' || !TIME_RX.test(s.startTime)) {
        return NextResponse.json({ error: '시간 형식이 올바르지 않습니다.' }, { status: 400 });
      }
    }

    const created = await prisma.tourSchedule.createMany({
      data: slots.map(s => ({
        tourId: id,
        date: s.date,
        startTime: s.startTime,
        capacity: Math.max(1, Math.min(1000, Number(s.capacity) || 1)),
      })),
      skipDuplicates: true,
    });

    return NextResponse.json({ created: created.count }, { status: 201 });
  } catch (e) {
    console.error('[tours/:id/schedule] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { scheduleId, capacity, status, note } = body;
    if (!scheduleId || typeof scheduleId !== 'string') {
      return NextResponse.json({ error: 'scheduleId는 필수입니다.' }, { status: 400 });
    }

    const owned = await authorizeTourSchedule(scheduleId, auth.session.userId, { isAdmin: auth.isAdmin });
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const data: { capacity?: number; status?: string; note?: string | null } = {};
    if (capacity !== undefined) data.capacity = Math.max(1, Math.min(1000, Number(capacity)));
    if (status !== undefined) {
      if (status !== 'open' && status !== 'closed' && status !== 'cancelled') {
        return NextResponse.json({ error: '잘못된 status 값입니다.' }, { status: 400 });
      }
      data.status = status;
    }
    if (note !== undefined) data.note = typeof note === 'string' ? note : null;

    const updated = await prisma.tourSchedule.update({ where: { id: scheduleId }, data });
    return NextResponse.json(updated);
  } catch (e) {
    console.error('[tours/:id/schedule] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const scheduleId = searchParams.get('scheduleId');
    if (!scheduleId) return NextResponse.json({ error: 'scheduleId는 필수입니다.' }, { status: 400 });

    const owned = await authorizeTourSchedule(scheduleId, auth.session.userId, { isAdmin: auth.isAdmin });
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const schedule = await prisma.tourSchedule.findUnique({
      where: { id: scheduleId },
      select: { bookedCount: true },
    });
    if (!schedule) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (schedule.bookedCount > 0) {
      return NextResponse.json(
        { error: '예약이 있는 슬롯은 삭제할 수 없습니다. 마감 처리하세요.' },
        { status: 409 },
      );
    }

    await prisma.tourSchedule.delete({ where: { id: scheduleId } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[tours/:id/schedule] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
