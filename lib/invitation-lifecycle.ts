import { randomBytes } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizeRole } from '@/lib/access';
import { auditData } from '@/lib/audit-log';
import { fail } from '@/lib/core/errors';
import type { SessionAuth } from '@/lib/auth';

type Tx = Prisma.TransactionClient;
const week = 7 * 86400_000;
const transaction = async <T,>(run: (tx: Tx) => Promise<T>) => {
  try { return await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') throw fail(409, '초대가 동시에 변경되었습니다. 새로고침 후 다시 시도해 주세요.'); throw error; }
};

function assertCanManage(auth: SessionAuth, invitation: { organizationId: string | null; role: string }) {
  if (auth.role === 'super_admin') return;
  if (auth.role !== 'admin' || !auth.user.organizationId || invitation.organizationId !== auth.user.organizationId || !['manager', 'cleaner'].includes(normalizeRole(invitation.role))) throw fail(403, '이 초대를 관리할 권한이 없습니다.');
}
async function validateDestination(tx: Tx, invitation: { organizationId: string | null; role: string; propertyIds: unknown; cleanerId: string | null }) {
  const role = normalizeRole(invitation.role);
  if (role === 'super_admin') throw fail(403, '초대로 슈퍼매니저 권한을 발급할 수 없습니다.');
  if (role === 'admin' && !invitation.organizationId) throw fail(400, '사업자 소속이 없는 관리자 초대는 회수하고 다시 발급해 주세요.');
  if (invitation.organizationId && !(await tx.organization.findFirst({ where: { id: invitation.organizationId, status: 'active' }, select: { id: true } }))) throw fail(403, '사용이 중지된 사업자의 초대입니다.');
  const propertyIds = role === 'manager' && Array.isArray(invitation.propertyIds) ? [...new Set(invitation.propertyIds.filter((id): id is string => typeof id === 'string'))] : [];
  if (propertyIds.length && await tx.property.count({ where: { id: { in: propertyIds }, organizationId: invitation.organizationId } }) !== propertyIds.length) throw fail(409, '배정 지점의 소속이 변경되었습니다. 초대를 회수하고 다시 발급해 주세요.');
  if (role === 'cleaner' && !invitation.cleanerId) throw fail(400, '청소 직원 프로필이 없는 초대입니다. 직원 관리에서 다시 발급해 주세요.');
  return { role, propertyIds };
}

export async function renewInvitation(auth: SessionAuth, token: string, origin: string) {
  return transaction(async tx => {
    const current = await tx.invitation.findUnique({ where: { token } });
    if (!current) throw fail(404, '초대를 찾을 수 없습니다.');
    assertCanManage(auth, current);
    if (!['pending', 'expired'].includes(current.status)) throw fail(409, '이미 수락하거나 회수한 초대는 재발급할 수 없습니다.');
    await validateDestination(tx, current);
    const newToken = randomBytes(32).toString('base64url');
    if ((await tx.invitation.updateMany({ where: { id: current.id, token, status: { in: ['pending', 'expired'] } }, data: { token: newToken, status: 'pending', expiresAt: new Date(Date.now() + week) } })).count !== 1) throw fail(409, '초대가 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
    await tx.auditLog.create({ data: auditData(auth, { action: 'invitation.renew', module: 'staff', targetType: 'invitation', targetId: current.id, organizationId: current.organizationId ?? undefined, summary: '직원 초대 링크 재발급', details: { changedFields: ['expiresAt', 'status'] } }) });
    const saved = await tx.invitation.findUniqueOrThrow({ where: { id: current.id }, select: { id: true, email: true, role: true, organizationId: true, status: true, expiresAt: true } });
    return { invitation: saved, invitationUrl: `${origin}/invite/${newToken}` };
  });
}

export async function revokeInvitation(auth: SessionAuth, token: string) {
  return transaction(async tx => {
    const current = await tx.invitation.findUnique({ where: { token } });
    if (!current) throw fail(404, '초대를 찾을 수 없습니다.');
    assertCanManage(auth, current);
    if (current.status === 'revoked') return { success: true };
    if (!['pending', 'expired'].includes(current.status)) throw fail(409, '이미 수락한 초대는 회수할 수 없습니다. 사용자 권한에서 계정을 관리해 주세요.');
    if ((await tx.invitation.updateMany({ where: { id: current.id, token, status: { in: ['pending', 'expired'] } }, data: { status: 'revoked' } })).count !== 1) throw fail(409, '초대가 변경되었습니다.');
    await tx.auditLog.create({ data: auditData(auth, { action: 'invitation.revoke', module: 'staff', targetType: 'invitation', targetId: current.id, organizationId: current.organizationId ?? undefined, summary: '직원 초대 링크 회수', details: { changedFields: ['status'] } }) });
    return { success: true };
  });
}

/** An authenticated email owner claims the invitation; knowing its email alone never does. */
export async function acceptInvitation(auth: SessionAuth, token: string) {
  if (!['active', 'pending_invite'].includes(auth.user.status)) throw fail(403, '사용이 중지된 계정은 초대를 수락할 수 없습니다.');
  return transaction(async tx => {
    const invitation = await tx.invitation.findUnique({ where: { token } });
    if (!invitation || !['pending', 'accepted'].includes(invitation.status)) throw fail(404, '유효하지 않거나 회수된 초대입니다.');
    const actor = await tx.user.findUnique({ where: { id: auth.session.userId }, include: { properties: true } });
    if (!actor || !['active', 'pending_invite'].includes(actor.status) || actor.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) throw fail(403, '초대받은 이메일의 계정으로 로그인해 주세요.');
    if (invitation.status === 'accepted') {
      if (normalizeRole(actor.role) !== normalizeRole(invitation.role) || (actor.organizationId ?? null) !== invitation.organizationId) throw fail(409, '이미 사용된 초대입니다.');
      return actor;
    }
    if (invitation.expiresAt <= new Date()) throw fail(410, '초대가 만료되었습니다. 관리자에게 재발급을 요청해 주세요.');
    const { role, propertyIds } = await validateDestination(tx, invitation);
    const pendingUnassigned = actor.status === 'pending_invite' && !actor.organizationId && actor.properties.length === 0 && normalizeRole(actor.role) === 'manager';
    if (!pendingUnassigned && ((actor.organizationId ?? null) !== invitation.organizationId || ['super_admin', 'admin'].includes(normalizeRole(actor.role)))) throw fail(403, '기존 관리자 권한이나 다른 사업자 소속은 초대로 변경할 수 없습니다. 슈퍼매니저에게 요청해 주세요.');
    if ((await tx.invitation.updateMany({ where: { id: invitation.id, token, status: 'pending', expiresAt: { gt: new Date() } }, data: { status: 'accepted' } })).count !== 1) throw fail(409, '이미 사용했거나 변경된 초대입니다.');
    let targetId = actor.id;
    if (invitation.cleanerId && invitation.cleanerId !== actor.id) {
      const staff = await tx.user.findUnique({ where: { id: invitation.cleanerId } });
      if (!pendingUnassigned || !staff || staff.status !== 'no_account' || normalizeRole(staff.role) !== role || (staff.organizationId ?? null) !== invitation.organizationId) throw fail(409, '청소 직원 프로필과 로그인 계정의 연결을 관리자에게 확인해 주세요.');
      // Keep both IDs and their historical records. Revoke the unused pending identity.
      await tx.user.update({ where: { id: actor.id }, data: { email: `archived-invite-${actor.id}@accounts.invalid`, status: 'suspended', accessVersion: { increment: 1 } } });
      await tx.user.update({ where: { id: staff.id }, data: { email: actor.email, password: actor.password, status: 'active', accessVersion: { increment: 1 } } });
      targetId = staff.id;
    } else {
      await tx.user.update({ where: { id: actor.id }, data: { role, organizationId: invitation.organizationId, status: 'active', ...((pendingUnassigned || role !== normalizeRole(actor.role)) ? { enabledModules: Prisma.DbNull } : {}), ownerId: invitation.invitedBy, accessVersion: { increment: 1 } } });
      if (['manager', 'admin'].includes(role)) {
        await tx.userProperty.deleteMany({ where: { userId: actor.id } });
        if (propertyIds.length) await tx.userProperty.createMany({ data: propertyIds.map(propertyId => ({ userId: actor.id, propertyId })) });
      }
    }
    await tx.auditLog.create({ data: auditData(auth, { action: 'invitation.accept', module: 'staff', targetType: 'user', targetId, organizationId: invitation.organizationId ?? undefined, summary: '직원 초대 수락·소속과 권한 적용', details: { changedFields: ['role', 'organizationId', 'status', 'propertyIds'], ...(targetId !== actor.id ? { sourceUserId: actor.id } : {}) } }) });
    return tx.user.findUniqueOrThrow({ where: { id: targetId }, include: { properties: { select: { propertyId: true } } } });
  });
}
