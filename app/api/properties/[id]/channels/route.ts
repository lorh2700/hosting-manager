import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const channels = await prisma.propertyChannel.findMany({ where: { propertyId: id } });
  return NextResponse.json(channels);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const channel = await prisma.propertyChannel.create({
    data: {
      propertyId: id,
      name: body.name,
      importUrl: body.importUrl,
      exportUrl: body.exportUrl,
      isActive: body.isActive ?? true,
    },
  });
  return NextResponse.json(channel, { status: 201 });
}

export async function PUT(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { channelId, ...data } = body;
  const updated = await prisma.propertyChannel.update({ where: { id: channelId }, data });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get('channelId');
  if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 });
  await prisma.propertyChannel.delete({ where: { id: channelId } });
  return NextResponse.json({ success: true });
}
