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
    const isOpen = searchParams.get('isOpen');

    const where: Record<string, unknown> = {};
    if (propertyIds?.length) where.propertyId = { in: propertyIds };
    if (status) where.status = status;
    if (isOpen === 'true') where.isOpen = true;

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
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.propertyId || !body.date) {
      return NextResponse.json({ error: 'propertyId, date는 필수입니다.' }, { status: 400 });
    }

    const cleaning = await prisma.cleaning.create({ data: body });
    return NextResponse.json(cleaning, { status: 201 });
  } catch (e) {
    console.error('[cleanings] POST error:', e);
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

    const cleaning = await prisma.cleaning.update({ where: { id }, data });
    return NextResponse.json(cleaning);
  } catch (e) {
    console.error('[cleanings] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    await prisma.cleaning.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[cleanings] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
