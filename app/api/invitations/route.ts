import { staffDirectory } from '@/lib/staff-directory';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, created, fail, readJson, str } from '@/lib/core/http';
import type { UserRole } from '@/lib/types';
import { canAdministerUser, staffTenantWhere } from '@/lib/user-management';
import { normalizeRole } from '@/lib/access';

// 관리자·매니저는 여기서 초대한다. 청소담당자 초대는 프로필에서(/api/cleaners/[id]/invite) —
// 프로필 없는 청소담당자 계정을 만들지 않기 위해 cleanerId 없는 cleaner 초대는 거절한다.
const INVITABLE_ROLES: UserRole[] = ['admin', 'manager', 'cleaner'];

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

export const GET = withAuth('invitations', async (_req, { auth }) => {
  if (auth.role === 'admin' && !auth.user.organizationId) return ok([]);
  const rows = await prisma.invitation.findMany({ where: staffTenantWhere(auth), orderBy: { createdAt: 'desc' }, take: 200 });
  return ok(rows.map(row => ({ ...row, status: row.status === 'pending' && row.expiresAt <= new Date() ? 'expired' : row.status })));
}, { businessAdmin: true });

export const POST = withAuth('invitations', async (req, { auth }) => {
  const body = await readJson(req);
  const email = str(body, 'email', { required: true, max: 200 })!.trim().toLowerCase();
  const role = str(body, 'role', { required: true })! as UserRole;
  if (!INVITABLE_ROLES.includes(role)) throw fail(400, '유효하지 않은 역할입니다.');
  if (role === 'admin') throw fail(403, '사업자 관리자 초대는 사업자 설정에서 슈퍼매니저가 발급합니다.');
  const organizationId = auth.role === 'super_admin' ? str(body, 'organizationId') || null : auth.user.organizationId;
  if (auth.role === 'admin' && (!organizationId || (body.organizationId && body.organizationId !== organizationId))) throw fail(403, '자기 사업자의 사용자만 초대할 수 있습니다.');
  const cleanerId = str(body, 'cleanerId') || null;
  // 숙소 범위는 매니저에게만 의미가 있다 (관리자는 전체, 청소담당자는 프로필 배정).
  const propertyIds = role === 'manager' && Array.isArray(body.propertyIds)
    ? (body.propertyIds as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];
  if (propertyIds.length && await prisma.property.count({ where: { id: { in: [...new Set(propertyIds)] }, organizationId } }) !== new Set(propertyIds).size) throw fail(403, '같은 사업자의 숙소만 배정할 수 있습니다.');

  if (role === 'cleaner' && !cleanerId) throw fail(400, '청소담당자는 청소 담당자 관리에서 프로필을 만든 뒤 초대하세요.');
  if (cleanerId) {
    const cleaner = await staffDirectory.findUnique({ where: { id: cleanerId }, select: { id: true, userId: true } });
    if (!cleaner) throw fail(404, '청소 담당자를 찾을 수 없습니다.');
    if (!canAdministerUser(auth, { id: cleaner.id, role: cleaner.role, organizationId: cleaner.organizationId })) throw fail(403, '이 직원을 초대할 권한이 없습니다.');
    if (cleaner.role !== role) throw fail(400, '직원에게 지정된 관리 역할로 초대해 주세요.');
    if (cleaner.status !== 'no_account') throw fail(409, '이미 로그인 계정과 연결된 담당자입니다.');
  }

  const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, include: { properties: true } });
  if (existing) {
    const pendingUnassigned = existing.status === 'pending_invite' && !existing.organizationId && existing.properties.length === 0 && normalizeRole(existing.role) === 'manager';
    const sameBusinessStaff = existing.status === 'active' && (existing.organizationId ?? null) === organizationId && !['admin', 'super_admin'].includes(normalizeRole(existing.role)) && !cleanerId;
    if (!pendingUnassigned && !sameBusinessStaff) throw fail(409, '기존 관리자 또는 다른 사업자의 계정입니다. 사용자·권한에서 계정을 확인해 주세요.');
  }
  if (await prisma.invitation.findFirst({ where: { email, status: 'pending', expiresAt: { gt: new Date() } } })) throw fail(409, '이미 대기중인 초대가 있습니다.');
  await prisma.invitation.updateMany({ where: { email, status: 'pending', expiresAt: { lte: new Date() } }, data: { status: 'expired' } });

  const invitation = await prisma.invitation.create({
    data: {
      email,
      role,
      organizationId,
      propertyIds,
      invitedBy: auth.session.userId,
      cleanerId,
      status: 'pending',
      token: generateToken(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return created({ ...invitation, inviteLink: `/invite/${invitation.token}` });
}, { businessAdmin: true });
