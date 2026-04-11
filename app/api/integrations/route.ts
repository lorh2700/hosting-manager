import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';
import type { IntegrationProvider, IntegrationType } from '@/lib/types';

export async function GET(req: Request) {
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { properties: true },
  });
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get('propertyId');

  let integrations;
  if (propertyId) {
    integrations = await prisma.integration.findMany({ where: { propertyId } });
  } else if (['super_admin', 'admin'].includes(user.role)) {
    integrations = await prisma.integration.findMany();
  } else {
    const propIds = user.properties.map(p => p.propertyId);
    if (propIds.length === 0) return NextResponse.json([]);
    integrations = await prisma.integration.findMany({ where: { propertyId: { in: propIds } } });
  }

  return NextResponse.json(integrations);
}

export async function POST(req: Request) {
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const body = await req.json();
  const { propertyId, provider, type, config, syncIntervalMinutes } = body as {
    propertyId: string;
    provider: IntegrationProvider;
    type: IntegrationType;
    config: Record<string, string>;
    syncIntervalMinutes?: number;
  };

  if (!propertyId || !provider || !type) {
    return NextResponse.json({ error: 'propertyId, provider, type은 필수입니다.' }, { status: 400 });
  }

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) {
    return NextResponse.json({ error: '숙소를 찾을 수 없습니다.' }, { status: 404 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || (!['super_admin', 'admin'].includes(user.role) && property.ownerId !== session.userId)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const integration = await prisma.integration.create({
    data: {
      propertyId,
      provider,
      type,
      config: config ?? {},
      status: 'active',
      syncIntervalMinutes: syncIntervalMinutes ?? 15,
    },
  });

  return NextResponse.json(integration, { status: 201 });
}

export async function PUT(req: Request) {
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });
  }

  const integ = await prisma.integration.findUnique({ where: { id }, include: { property: true } });
  if (!integ) {
    return NextResponse.json({ error: '연동을 찾을 수 없습니다.' }, { status: 404 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || (!['super_admin', 'admin'].includes(user.role) && integ.property.ownerId !== session.userId)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const allowedFields = ['config', 'status', 'syncIntervalMinutes', 'lastSyncAt', 'lastSyncStatus', 'lastErrorMessage'];
  const safeUpdates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in updates) safeUpdates[key] = updates[key];
  }

  const updated = await prisma.integration.update({ where: { id }, data: safeUpdates });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request) {
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });
  }

  const integ = await prisma.integration.findUnique({ where: { id }, include: { property: true } });
  if (!integ) {
    return NextResponse.json({ error: '연동을 찾을 수 없습니다.' }, { status: 404 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || (!['super_admin', 'admin'].includes(user.role) && integ.property.ownerId !== session.userId)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  await prisma.integration.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
