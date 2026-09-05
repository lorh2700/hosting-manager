import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';

const ROLES = ['super_admin', 'admin', 'host', 'cleaner', 'viewer'] as const;
const STATUSES = ['active', 'suspended', 'pending_invite'] as const;

// 본인 프로필 수정에서 허용하는 필드. role/status/email 은 관리자만 바꿀 수 있다.
const SELF_FIELDS = ['displayName', 'phone'] as const;
const ADMIN_FIELDS = ['displayName', 'phone', 'email', 'role', 'status'] as const;

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!auth.isAdmin) return forbidden();

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

/**
 * 사용자 수정.
 *  - 본인: displayName, phone 만
 *  - 관리자: 위 + email, role, status, propertyIds (대상 누구나)
 *  - super_admin 권한 부여/수정은 super_admin 만
 *  - 본인 role/status 는 여기서 바꿀 수 없다 (실수로 스스로 잠그는 것 방지)
 * 그 밖의 필드(비밀번호 등)는 무시된다 — 비밀번호는 /api/auth/change-password.
 */
export async function PUT(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as Record<string, unknown>;
    const targetId = typeof body.id === 'string' && body.id ? body.id : auth.session.userId;
    const isSelf = targetId === auth.session.userId;

    if (!isSelf && !auth.isAdmin) return forbidden();

    const target = isSelf
      ? auth.user
      : await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (!isSelf && target.role === 'super_admin' && auth.user.role !== 'super_admin') {
      return forbidden();
    }

    const allowed: readonly string[] = auth.isAdmin ? ADMIN_FIELDS : SELF_FIELDS;
    const data: Record<string, unknown> = {};

    if (allowed.includes('displayName') && typeof body.displayName === 'string') {
      data.displayName = body.displayName.trim().slice(0, 100);
    }
    if (allowed.includes('phone') && (typeof body.phone === 'string' || body.phone === null)) {
      data.phone = body.phone ? String(body.phone).trim().slice(0, 40) : null;
    }
    if (allowed.includes('email') && typeof body.email === 'string' && !isSelf) {
      const email = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: '이메일 형식이 올바르지 않습니다.' }, { status: 400 });
      }
      data.email = email;
    }
    if (allowed.includes('role') && typeof body.role === 'string' && !isSelf) {
      if (!(ROLES as readonly string[]).includes(body.role)) {
        return NextResponse.json({ error: '유효하지 않은 역할입니다.' }, { status: 400 });
      }
      if (body.role === 'super_admin' && auth.user.role !== 'super_admin') return forbidden();
      data.role = body.role;
    }
    if (allowed.includes('status') && typeof body.status === 'string' && !isSelf) {
      if (!(STATUSES as readonly string[]).includes(body.status)) {
        return NextResponse.json({ error: '유효하지 않은 상태입니다.' }, { status: 400 });
      }
      data.status = body.status;
    }

    const propertyIds = auth.isAdmin && Array.isArray(body.propertyIds)
      ? (body.propertyIds as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
      : null;

    if (Object.keys(data).length === 0 && propertyIds === null) {
      return NextResponse.json({ error: '변경할 수 있는 필드가 없습니다.' }, { status: 400 });
    }

    const updated = Object.keys(data).length > 0
      ? await prisma.user.update({ where: { id: targetId }, data })
      : target;

    if (propertyIds !== null) {
      await prisma.userProperty.deleteMany({ where: { userId: targetId } });
      if (propertyIds.length > 0) {
        await prisma.userProperty.createMany({
          data: propertyIds.map((pid) => ({ userId: targetId, propertyId: pid })),
        });
      }
    }

    return NextResponse.json({
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      phone: updated.phone,
      role: updated.role,
      status: updated.status,
      propertyIds: propertyIds ?? undefined,
    });
  } catch (e) {
    console.error('[users] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
