import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, canManageProperty, getVisiblePropertyIds } from '@/lib/auth';

function forbidden() {
  return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
}

function pickChannelFields(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string') data.name = body.name.trim().slice(0, 100);
  if (typeof body.importUrl === 'string' || body.importUrl === null) data.importUrl = body.importUrl;
  if (typeof body.exportUrl === 'string' || body.exportUrl === null) data.exportUrl = body.exportUrl;
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
  return data;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getSessionWithUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const visible = await getVisiblePropertyIds(auth, [id]);
  if (visible !== null && visible.length === 0) return forbidden();

  const channels = await prisma.propertyChannel.findMany({ where: { propertyId: id } });
  return NextResponse.json(channels);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getSessionWithUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!canManageProperty(auth, id)) return forbidden();

  const body = (await req.json()) as Record<string, unknown>;
  const data = pickChannelFields(body);
  if (typeof data.name !== 'string' || !data.name) {
    return NextResponse.json({ error: 'name은 필수입니다.' }, { status: 400 });
  }

  const channel = await prisma.propertyChannel.create({
    data: {
      propertyId: id,
      name: data.name,
      importUrl: (data.importUrl as string | null | undefined) ?? null,
      exportUrl: (data.exportUrl as string | null | undefined) ?? null,
      isActive: (data.isActive as boolean | undefined) ?? true,
    },
  });
  return NextResponse.json(channel, { status: 201 });
}

export async function PUT(req: Request) {
  const auth = await getSessionWithUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as Record<string, unknown>;
  const channelId = typeof body.channelId === 'string' ? body.channelId : null;
  if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 });

  const channel = await prisma.propertyChannel.findUnique({ where: { id: channelId }, select: { propertyId: true } });
  if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canManageProperty(auth, channel.propertyId)) return forbidden();

  const data = pickChannelFields(body);
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '업데이트할 필드가 없습니다.' }, { status: 400 });
  }

  const updated = await prisma.propertyChannel.update({ where: { id: channelId }, data });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request) {
  const auth = await getSessionWithUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get('channelId');
  if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 });

  const channel = await prisma.propertyChannel.findUnique({ where: { id: channelId }, select: { propertyId: true } });
  if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canManageProperty(auth, channel.propertyId)) return forbidden();

  await prisma.propertyChannel.delete({ where: { id: channelId } });
  return NextResponse.json({ success: true });
}
