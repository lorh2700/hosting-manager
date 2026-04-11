import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
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
}

export async function POST(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const cleaning = await prisma.cleaning.create({ data: body });
  return NextResponse.json(cleaning, { status: 201 });
}

export async function PUT(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, ...data } = body;
  const cleaning = await prisma.cleaning.update({ where: { id }, data });
  return NextResponse.json(cleaning);
}

export async function DELETE(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.cleaning.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
