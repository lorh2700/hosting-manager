import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get('propertyId');

  const where: Record<string, unknown> = {};
  if (propertyId) where.propertyId = propertyId;

  const todos = await prisma.supplyTodo.findMany({ where, orderBy: { createdAt: 'desc' } });
  return NextResponse.json(todos);
}

export async function POST(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const todo = await prisma.supplyTodo.create({ data: body });
  return NextResponse.json(todo, { status: 201 });
}

export async function PUT(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, ...data } = body;
  const todo = await prisma.supplyTodo.update({ where: { id }, data });
  return NextResponse.json(todo);
}

export async function DELETE(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.supplyTodo.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
