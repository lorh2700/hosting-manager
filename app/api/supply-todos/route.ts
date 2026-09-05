import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, canManageProperty, getVisiblePropertyIds } from '@/lib/auth';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function forbidden() {
  return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
}

function pickTodoFields(body: Record<string, unknown>) {
  const data: { text?: string; date?: string | null; done?: boolean } = {};
  // 예전 클라이언트는 name 으로 보냈다 — text 로 통일.
  const text = typeof body.text === 'string' ? body.text : (typeof body.name === 'string' ? body.name : undefined);
  if (text !== undefined) data.text = text.trim().slice(0, 500);
  if (body.date === null) data.date = null;
  else if (typeof body.date === 'string' && DATE_RE.test(body.date)) data.date = body.date;
  if (typeof body.done === 'boolean') data.done = body.done;
  return data;
}

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get('propertyId');

    const where: Record<string, unknown> = {};
    const visible = await getVisiblePropertyIds(auth, propertyId ? [propertyId] : null);
    if (visible !== null) {
      if (visible.length === 0) return NextResponse.json([]);
      where.propertyId = { in: visible };
    } else if (propertyId) {
      where.propertyId = propertyId;
    }

    const todos = await prisma.supplyTodo.findMany({ where, orderBy: { createdAt: 'desc' } });
    return NextResponse.json(todos);
  } catch (e) {
    console.error('[supply-todos] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as Record<string, unknown>;
    const propertyId = typeof body.propertyId === 'string' ? body.propertyId : null;
    const data = pickTodoFields(body);
    if (!propertyId || !data.text) {
      return NextResponse.json({ error: 'propertyId, text는 필수입니다.' }, { status: 400 });
    }
    if (!canManageProperty(auth, propertyId)) return forbidden();

    const todo = await prisma.supplyTodo.create({
      data: { propertyId, text: data.text, date: data.date ?? null, done: data.done ?? false },
    });
    return NextResponse.json(todo, { status: 201 });
  } catch (e) {
    console.error('[supply-todos] POST error:', e);
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

    const existing = await prisma.supplyTodo.findUnique({ where: { id }, select: { propertyId: true } });
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!canManageProperty(auth, existing.propertyId)) return forbidden();

    const data = pickTodoFields(body);
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '업데이트할 필드가 없습니다.' }, { status: 400 });
    }

    const todo = await prisma.supplyTodo.update({ where: { id }, data });
    return NextResponse.json(todo);
  } catch (e) {
    console.error('[supply-todos] PUT error:', e);
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

    const existing = await prisma.supplyTodo.findUnique({ where: { id }, select: { propertyId: true } });
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!canManageProperty(auth, existing.propertyId)) return forbidden();

    await prisma.supplyTodo.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[supply-todos] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
