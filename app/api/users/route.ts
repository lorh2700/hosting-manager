import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !['super_admin', 'admin'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    include: { properties: { include: { property: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(users.map(u => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    phone: u.phone,
    role: u.role,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    propertyIds: u.properties.map(p => p.propertyId),
    propertyNames: u.properties.map(p => p.property.name),
  })));
}

export async function PUT(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, propertyIds, ...data } = body;

  // Self-update (profile)
  const targetId = id || session.userId;

  // Only admins can update other users
  if (id && id !== session.userId) {
    const me = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!me || !['super_admin', 'admin'].includes(me.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const updated = await prisma.user.update({ where: { id: targetId }, data });

  // Update property associations if provided
  if (propertyIds && Array.isArray(propertyIds)) {
    await prisma.userProperty.deleteMany({ where: { userId: targetId } });
    if (propertyIds.length > 0) {
      await prisma.userProperty.createMany({
        data: propertyIds.map((pid: string) => ({ userId: targetId, propertyId: pid })),
      });
    }
  }

  return NextResponse.json(updated);
}
