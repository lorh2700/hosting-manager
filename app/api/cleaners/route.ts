import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession, getSessionWithUser } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const cleaners = auth.isAdmin
      ? await prisma.cleaner.findMany({ orderBy: { createdAt: 'desc' } })
      : await prisma.cleaner.findMany({ where: { ownerId: auth.session.userId }, orderBy: { createdAt: 'desc' } });

    return NextResponse.json(cleaners);
  } catch (e) {
    console.error('[cleaners] GET error:', e);
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

    const cleaner = await prisma.cleaner.create({
      data: { name: body.name, phone: body.phone, ownerId: session.userId },
    });
    return NextResponse.json(cleaner, { status: 201 });
  } catch (e) {
    console.error('[cleaners] POST error:', e);
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

    const cleaner = await prisma.cleaner.update({ where: { id }, data });
    return NextResponse.json(cleaner);
  } catch (e) {
    console.error('[cleaners] PUT error:', e);
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

    await prisma.cleaner.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[cleaners] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
