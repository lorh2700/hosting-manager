import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, canManageProperty, getVisiblePropertyIds } from '@/lib/auth';

function forbidden() {
  return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
}

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const requested = searchParams.get('propertyIds')?.split(',').filter(Boolean);
    const status = searchParams.get('status');

    const where: Record<string, unknown> = {};
    // 청소매니저는 자기 호스트의 숙소 요청을, 호스트는 담당 숙소 요청을 본다.
    const visible = await getVisiblePropertyIds(auth, requested);
    if (visible !== null) {
      if (visible.length === 0) return NextResponse.json([]);
      where.propertyId = { in: visible };
    }
    if (status) where.status = status;

    const requests = await prisma.supplyRequest.findMany({ where, orderBy: { createdAt: 'desc' } });
    return NextResponse.json(requests);
  } catch (e) {
    console.error('[supply-requests] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.propertyId || typeof body.propertyId !== 'string') {
      return NextResponse.json({ error: 'propertyId는 필수입니다.' }, { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: 'items 배열에 최소 1개 이상의 품목이 필요합니다.' }, { status: 400 });
    }

    // 청소매니저도 자기가 청소하는 숙소에는 요청을 올릴 수 있다.
    const visible = await getVisiblePropertyIds(auth, [body.propertyId]);
    if (visible !== null && visible.length === 0) return forbidden();

    // Whitelist fields (prevent mass-assignment + drop unknown fields).
    const request = await prisma.supplyRequest.create({
      data: {
        propertyId: body.propertyId,
        requestedBy: auth.session.userId,                  // always trust session
        requestedByName: typeof body.requestedByName === 'string' ? body.requestedByName : null,
        items: body.items,
        urgency: typeof body.urgency === 'string' ? body.urgency : 'normal',
        status: 'pending',                                 // always start as pending
        statusNote: typeof body.statusNote === 'string' ? body.statusNote : null,
      },
    });
    return NextResponse.json(request, { status: 201 });
  } catch (e) {
    console.error('[supply-requests] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const existing = await prisma.supplyRequest.findUnique({ where: { id }, select: { propertyId: true } });
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
    // 처리 상태 변경은 호스트/관리자만.
    if (!canManageProperty(auth, existing.propertyId)) return forbidden();

    const data: { status?: string; statusNote?: string | null; urgency?: string } = {};
    if (typeof body.status === 'string') data.status = body.status;
    if (body.statusNote !== undefined) data.statusNote = typeof body.statusNote === 'string' ? body.statusNote : null;
    if (typeof body.urgency === 'string') data.urgency = body.urgency;

    const request = await prisma.supplyRequest.update({ where: { id }, data });
    return NextResponse.json(request);
  } catch (e) {
    console.error('[supply-requests] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
