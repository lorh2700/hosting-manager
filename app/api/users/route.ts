import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  try {
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
  } catch (e) {
    console.error('[users] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { id, propertyIds, ...data } = body;

    const targetId = id || session.userId;

    if (id && id !== session.userId) {
      const me = await prisma.user.findUnique({ where: { id: session.userId } });
      if (!me || !['super_admin', 'admin'].includes(me.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const updated = await prisma.user.update({ where: { id: targetId }, data });

    if (propertyIds && Array.isArray(propertyIds)) {
      await prisma.userProperty.deleteMany({ where: { userId: targetId } });
      if (propertyIds.length > 0) {
        await prisma.userProperty.createMany({
          data: propertyIds.map((pid: string) => ({ userId: targetId, propertyId: pid })),
        });
      }
    }

    return NextResponse.json(updated);
  } catch (e) {
    console.error('[users] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
