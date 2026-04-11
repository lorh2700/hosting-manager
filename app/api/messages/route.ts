import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get('eventId');
  const propertyIds = searchParams.get('propertyIds')?.split(',').filter(Boolean);

  const where: Record<string, unknown> = {};
  if (eventId) where.eventId = eventId;
  if (propertyIds?.length) where.propertyId = { in: propertyIds };

  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json(messages);
}

export async function POST(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const message = await prisma.message.create({ data: body });
  return NextResponse.json(message, { status: 201 });
}

export async function PUT(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, ids, ...data } = body;

  // Batch update (mark read)
  if (ids && Array.isArray(ids)) {
    await prisma.message.updateMany({ where: { id: { in: ids } }, data });
    return NextResponse.json({ success: true });
  }

  if (id) {
    const msg = await prisma.message.update({ where: { id }, data });
    return NextResponse.json(msg);
  }

  return NextResponse.json({ error: 'id or ids required' }, { status: 400 });
}
