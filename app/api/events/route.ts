import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const propertyIds = searchParams.get('propertyIds')?.split(',').filter(Boolean);
  const type = searchParams.get('type');

  const where: Record<string, unknown> = {};
  if (propertyIds?.length) where.propertyId = { in: propertyIds };
  if (type) where.type = type;

  const events = await prisma.event.findMany({ where, orderBy: { startDate: 'asc' } });
  return NextResponse.json(events);
}

export async function POST(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const event = await prisma.event.create({
    data: {
      propertyId: body.propertyId,
      channelId: body.channelId,
      source: body.source,
      title: body.title,
      startDate: body.startDate || body.start,
      endDate: body.endDate || body.end,
      type: body.type || 'reservation',
      originalUid: body.originalUid,
      description: body.description,
    },
  });
  return NextResponse.json(event, { status: 201 });
}

export async function PUT(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, ...data } = body;
  // Normalize field names
  if (data.start) { data.startDate = data.start; delete data.start; }
  if (data.end) { data.endDate = data.end; delete data.end; }
  const event = await prisma.event.update({ where: { id }, data });
  return NextResponse.json(event);
}

export async function DELETE(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.event.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
