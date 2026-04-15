import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.name) {
      return NextResponse.json({ error: 'name은 필수입니다.' }, { status: 400 });
    }

    const guest = await prisma.guest.create({ data: body });
    return NextResponse.json(guest, { status: 201 });
  } catch (e) {
    console.error('[guests] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const guest = await prisma.guest.update({ where: { id }, data });
    return NextResponse.json(guest);
  } catch (e) {
    console.error('[guests] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
