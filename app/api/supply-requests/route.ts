import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const propertyIds = searchParams.get('propertyIds')?.split(',').filter(Boolean);
    const status = searchParams.get('status');

    const where: Record<string, unknown> = {};
    if (propertyIds?.length) where.propertyId = { in: propertyIds };
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
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.propertyId) {
      return NextResponse.json({ error: 'propertyId는 필수입니다.' }, { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: 'items 배열에 최소 1개 이상의 품목이 필요합니다.' }, { status: 400 });
    }

    // Whitelist fields (prevent mass-assignment + drop unknown fields).
    const request = await prisma.supplyRequest.create({
      data: {
        propertyId: body.propertyId,
        requestedBy: session.userId,                       // always trust session
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
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

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
