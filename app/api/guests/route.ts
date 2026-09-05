import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, type SessionAuth } from '@/lib/auth';

function forbidden() {
  return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
}

// 게스트 명부는 숙소 단위가 아니라 사업장 단위 데이터. 호스트/관리자만 다룬다.
function canUseGuestBook(auth: SessionAuth): boolean {
  return auth.isAdmin || auth.user.role === 'host';
}

function pickGuestFields(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string') data.name = body.name.trim().slice(0, 100);
  if (typeof body.email === 'string' || body.email === null) data.email = body.email ? String(body.email).trim().slice(0, 200) : null;
  if (typeof body.phone === 'string' || body.phone === null) data.phone = body.phone ? String(body.phone).trim().slice(0, 40) : null;
  if (typeof body.source === 'string' || body.source === null) data.source = body.source ? String(body.source).slice(0, 50) : null;
  if (typeof body.notes === 'string' || body.notes === null) data.notes = body.notes ? String(body.notes).slice(0, 2000) : null;
  if (typeof body.lastStayAt === 'string' || body.lastStayAt === null) data.lastStayAt = body.lastStayAt ? String(body.lastStayAt).slice(0, 10) : null;
  if (body.bookingCount !== undefined && Number.isFinite(Number(body.bookingCount))) {
    data.bookingCount = Math.max(0, Math.floor(Number(body.bookingCount)));
  }
  return data;
}

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!canUseGuestBook(auth)) return forbidden();

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get('limit')) || 500, 1000);
    const offset = Number(searchParams.get('offset')) || 0;

    const guests = await prisma.guest.findMany({
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return NextResponse.json(guests);
  } catch (e) {
    console.error('[guests] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!canUseGuestBook(auth)) return forbidden();

    const body = (await req.json()) as Record<string, unknown>;
    const data = pickGuestFields(body);
    if (typeof data.name !== 'string' || !data.name) {
      return NextResponse.json({ error: 'name은 필수입니다.' }, { status: 400 });
    }

    const guest = await prisma.guest.create({ data: { ...data, name: data.name } });
    return NextResponse.json(guest, { status: 201 });
  } catch (e) {
    console.error('[guests] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!canUseGuestBook(auth)) return forbidden();

    const body = (await req.json()) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const data = pickGuestFields(body);
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '업데이트할 필드가 없습니다.' }, { status: 400 });
    }

    const guest = await prisma.guest.update({ where: { id }, data });
    return NextResponse.json(guest);
  } catch (e) {
    console.error('[guests] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
