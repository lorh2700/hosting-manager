import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, canManageProperty, getVisiblePropertyIds } from '@/lib/auth';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function forbidden() {
  return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
}

// body 를 그대로 Prisma 에 넘기지 않는다 — 허용 필드만 골라 담는다.
function pickEventFields(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  const start = body.startDate ?? body.start;
  const end = body.endDate ?? body.end;
  if (typeof start === 'string' && DATE_RE.test(start.slice(0, 10))) data.startDate = start.slice(0, 10);
  if (typeof end === 'string' && DATE_RE.test(end.slice(0, 10))) data.endDate = end.slice(0, 10);
  if (typeof body.title === 'string') data.title = body.title.slice(0, 200);
  if (typeof body.description === 'string') data.description = body.description.slice(0, 2000);
  if (body.type === 'block' || body.type === 'reservation') data.type = body.type;
  if (typeof body.source === 'string') data.source = body.source.slice(0, 100);
  if (typeof body.channelId === 'string') data.channelId = body.channelId.slice(0, 100);
  if (typeof body.originalUid === 'string') data.originalUid = body.originalUid.slice(0, 200);
  if (Array.isArray(body.tags)) {
    data.tags = (body.tags as unknown[])
      .map(t => (typeof t === 'string' ? t.trim() : ''))
      .filter(t => t.length > 0 && t.length <= 40)
      .slice(0, 20);
  }
  return data;
}

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const requested = searchParams.get('propertyIds')?.split(',').filter(Boolean);
    const type = searchParams.get('type');
    const limit = Math.min(Number(searchParams.get('limit')) || 1000, 2000);
    const offset = Number(searchParams.get('offset')) || 0;

    const where: Record<string, unknown> = {};
    // 관리자는 전체(또는 요청한 숙소), 그 외는 볼 수 있는 숙소와의 교집합만.
    const visible = await getVisiblePropertyIds(auth, requested);
    if (visible !== null) {
      if (visible.length === 0) return NextResponse.json([]);
      where.propertyId = { in: visible };
    }
    if (type) where.type = type;

    const events = await prisma.event.findMany({
      where, orderBy: { startDate: 'asc' }, take: limit, skip: offset,
    });
    return NextResponse.json(events);
  } catch (e) {
    console.error('[events] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as Record<string, unknown>;
    const propertyId = typeof body.propertyId === 'string' ? body.propertyId : null;
    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId는 필수입니다.' }, { status: 400 });
    }
    if (!canManageProperty(auth, propertyId)) return forbidden();

    const data = pickEventFields(body);
    if (typeof data.startDate !== 'string' || typeof data.endDate !== 'string') {
      return NextResponse.json({ error: 'startDate, endDate(YYYY-MM-DD)는 필수입니다.' }, { status: 400 });
    }
    if (data.startDate >= data.endDate) {
      return NextResponse.json({ error: '종료일은 시작일보다 뒤여야 합니다.' }, { status: 400 });
    }

    const event = await prisma.event.create({
      data: {
        propertyId,
        channelId: (data.channelId as string | undefined) ?? null,
        source: (data.source as string | undefined) ?? null,
        title: (data.title as string | undefined) ?? null,
        startDate: data.startDate,
        endDate: data.endDate,
        type: (data.type as string | undefined) ?? 'reservation',
        originalUid: (data.originalUid as string | undefined) ?? null,
        description: (data.description as string | undefined) ?? null,
        tags: (data.tags as string[] | undefined) ?? [],
      },
    });
    return NextResponse.json(event, { status: 201 });
  } catch (e) {
    console.error('[events] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const existing = await prisma.event.findUnique({
      where: { id },
      select: { propertyId: true, startDate: true, endDate: true },
    });
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!canManageProperty(auth, existing.propertyId)) return forbidden();

    const data = pickEventFields(body);
    // 다른 숙소로 옮기는 것은 허용하지 않는다.
    delete data.channelId;
    delete data.originalUid;
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '업데이트할 필드가 없습니다.' }, { status: 400 });
    }
    const nextStart = (data.startDate as string | undefined) ?? existing.startDate;
    const nextEnd = (data.endDate as string | undefined) ?? existing.endDate;
    if (nextStart >= nextEnd) {
      return NextResponse.json({ error: '종료일은 시작일보다 뒤여야 합니다.' }, { status: 400 });
    }

    const event = await prisma.event.update({ where: { id }, data });
    return NextResponse.json(event);
  } catch (e) {
    console.error('[events] PUT error:', e);
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

    const existing = await prisma.event.findUnique({ where: { id }, select: { propertyId: true } });
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!canManageProperty(auth, existing.propertyId)) return forbidden();

    await prisma.event.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[events] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
