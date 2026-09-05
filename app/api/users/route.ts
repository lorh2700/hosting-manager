import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, MESSAGES, readJson, str } from '@/lib/core/http';

const ROLES = ['super_admin', 'admin', 'host', 'cleaner', 'viewer'] as const;
const STATUSES = ['active', 'suspended', 'pending_invite'] as const;

export const GET = withAuth('users', async () => {
  const users = await prisma.user.findMany({
    include: { properties: { include: { property: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  return ok(users.map(u => ({
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
}, { admin: true });

/**
 * 사용자 수정.
 *  - 본인: displayName, phone 만
 *  - 관리자: 위 + email, role, status, propertyIds (대상 누구나)
 *  - super_admin 권한 부여/수정은 super_admin 만
 *  - 본인 role/status 는 여기서 바꿀 수 없다 (실수로 스스로 잠그는 것 방지)
 * 그 밖의 필드(비밀번호 등)는 무시된다 — 비밀번호는 /api/auth/change-password.
 */
export const PUT = withAuth('users', async (req, { auth }) => {
  const body = await readJson(req);
  const targetId = str(body, 'id') || auth.session.userId;
  const isSelf = targetId === auth.session.userId;
  if (!isSelf && !auth.isAdmin) throw fail(403, MESSAGES.forbidden);

  const target = isSelf ? auth.user : await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw fail(404, MESSAGES.notFound);
  if (!isSelf && target.role === 'super_admin' && auth.user.role !== 'super_admin') throw fail(403, MESSAGES.forbidden);

  const data: Record<string, unknown> = {};
  const displayName = str(body, 'displayName', { max: 100 });
  if (displayName !== undefined) data.displayName = displayName.trim();
  if (typeof body.phone === 'string' || body.phone === null) data.phone = body.phone ? String(body.phone).trim().slice(0, 40) : null;

  if (auth.isAdmin && !isSelf) {
    const email = str(body, 'email');
    if (email !== undefined) {
      const normalized = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw fail(400, '이메일 형식이 올바르지 않습니다.');
      data.email = normalized;
    }
    const role = str(body, 'role');
    if (role !== undefined) {
      if (!(ROLES as readonly string[]).includes(role)) throw fail(400, '유효하지 않은 역할입니다.');
      if (role === 'super_admin' && auth.user.role !== 'super_admin') throw fail(403, MESSAGES.forbidden);
      data.role = role;
    }
    const status = str(body, 'status');
    if (status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(status)) throw fail(400, '유효하지 않은 상태입니다.');
      data.status = status;
    }
  }

  const propertyIds = auth.isAdmin && Array.isArray(body.propertyIds)
    ? (body.propertyIds as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
    : null;

  if (Object.keys(data).length === 0 && propertyIds === null) throw fail(400, '변경할 수 있는 필드가 없습니다.');

  const updated = Object.keys(data).length > 0
    ? await prisma.user.update({ where: { id: targetId }, data })
    : target;

  if (propertyIds !== null) {
    await prisma.userProperty.deleteMany({ where: { userId: targetId } });
    if (propertyIds.length > 0) {
      await prisma.userProperty.createMany({ data: propertyIds.map((pid) => ({ userId: targetId, propertyId: pid })) });
    }
  }

  return ok({
    id: updated.id,
    email: updated.email,
    displayName: updated.displayName,
    phone: updated.phone,
    role: updated.role,
    status: updated.status,
    propertyIds: propertyIds ?? undefined,
  });
});
