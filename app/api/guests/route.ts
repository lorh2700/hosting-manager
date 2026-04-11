import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET() {
  const guests = await prisma.guest.findMany({ orderBy: { updatedAt: 'desc' } });
  return NextResponse.json(guests);
}

export async function POST(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const guest = await prisma.guest.create({ data: body });
  return NextResponse.json(guest, { status: 201 });
}

export async function PUT(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, ...data } = body;
  const guest = await prisma.guest.update({ where: { id }, data });
  return NextResponse.json(guest);
}
