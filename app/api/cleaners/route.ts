import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cleaners = ['super_admin', 'admin'].includes(user.role)
    ? await prisma.cleaner.findMany({ orderBy: { createdAt: 'desc' } })
    : await prisma.cleaner.findMany({ where: { ownerId: session.userId }, orderBy: { createdAt: 'desc' } });

  return NextResponse.json(cleaners);
}

export async function POST(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const cleaner = await prisma.cleaner.create({
    data: { name: body.name, phone: body.phone, ownerId: session.userId },
  });
  return NextResponse.json(cleaner, { status: 201 });
}

export async function PUT(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, ...data } = body;
  const cleaner = await prisma.cleaner.update({ where: { id }, data });
  return NextResponse.json(cleaner);
}

export async function DELETE(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.cleaner.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
