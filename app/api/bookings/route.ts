import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const propertyIds = searchParams.get('propertyIds')?.split(',').filter(Boolean);
  const status = searchParams.get('status');

  const where: Record<string, unknown> = {};
  if (propertyIds?.length) where.propertyId = { in: propertyIds };
  if (status) where.status = status;

  const bookings = await prisma.booking.findMany({ where, orderBy: { createdAt: 'desc' } });
  return NextResponse.json(bookings);
}

export async function POST(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const booking = await prisma.booking.create({ data: body });
  return NextResponse.json(booking, { status: 201 });
}

export async function PUT(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, ...data } = body;
  const booking = await prisma.booking.update({ where: { id }, data });
  return NextResponse.json(booking);
}

export async function DELETE(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.booking.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
