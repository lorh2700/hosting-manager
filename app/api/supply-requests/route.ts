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

  const requests = await prisma.supplyRequest.findMany({ where, orderBy: { createdAt: 'desc' } });
  return NextResponse.json(requests);
}

export async function POST(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const request = await prisma.supplyRequest.create({ data: body });
  return NextResponse.json(request, { status: 201 });
}

export async function PUT(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, ...data } = body;
  const request = await prisma.supplyRequest.update({ where: { id }, data });
  return NextResponse.json(request);
}
