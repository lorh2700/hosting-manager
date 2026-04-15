import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get('propertyId');

    const where: Record<string, unknown> = {};
    if (propertyId) where.propertyId = propertyId;

    const todos = await prisma.supplyTodo.findMany({ where, orderBy: { createdAt: 'desc' } });
    return NextResponse.json(todos);
  } catch (e) {
    console.error('[supply-todos] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.propertyId || !body.name) {
      return NextResponse.json({ error: 'propertyId, name은 필수입니다.' }, { status: 400 });
    }

    const todo = await prisma.supplyTodo.create({ data: body });
    return NextResponse.json(todo, { status: 201 });
  } catch (e) {
    console.error('[supply-todos] POST error:', e);
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

    const todo = await prisma.supplyTodo.update({ where: { id }, data });
    return NextResponse.json(todo);
  } catch (e) {
    console.error('[supply-todos] PUT error:', e);
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

    await prisma.supplyTodo.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[supply-todos] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
