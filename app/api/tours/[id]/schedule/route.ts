import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const slots: BulkSlot[] = Array.isArray(body.slots) ? body.slots : [];
    if (slots.length === 0) {
      return NextResponse.json({ error: '추가할 슬롯이 없습니다.' }, { status: 400 });
    }

    const created = await prisma.tourSchedule.createMany({
      data: slots.map(s => ({
        tourId: id,
        date: s.date,
        startTime: s.startTime,
        capacity: Math.max(1, Number(s.capacity) || 1),
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
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { scheduleId, capacity, status, note } = body;
    if (!scheduleId) return NextResponse.json({ error: 'scheduleId는 필수입니다.' }, { status: 400 });

    const data: { capacity?: number; status?: string; note?: string | null } = {};
    if (capacity !== undefined) data.capacity = Math.max(1, Number(capacity));
    if (status !== undefined) data.status = status;
    if (note !== undefined) data.note = note ?? null;

    const updated = await prisma.tourSchedule.update({ where: { id: scheduleId }, data });
    return NextResponse.json(updated);
  } catch (e) {
    console.error('[tours/:id/schedule] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const scheduleId = searchParams.get('scheduleId');
    if (!scheduleId) return NextResponse.json({ error: 'scheduleId는 필수입니다.' }, { status: 400 });

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
