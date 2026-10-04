import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken, setSessionCookie } from '@/lib/auth';
import { normalizeRole } from '@/lib/access';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { withErrors, ok, fail, readJson, str } from '@/lib/core/http';
import type { UserRole } from '@/lib/types';
import { Prisma } from '@/generated/prisma/client';
import { auditData } from '@/lib/audit-log';

/**
 * 회원가입.
 *  - 초대(Invitation)가 있으면 그 역할로 즉시 활성화 (청소담당자 초대는 기존 프로필에 연결)
 *  - 없으면 매니저 역할로 승인 대기(pending_invite) — 관리자가 유저 관리에서 역할·숙소를 정해 승인한다
 *  - 첫 사용자는 부트스트랩을 위해 관리자로 자동 활성화
 * 승인 대기 계정은 세션은 받지만 API 는 쓸 수 없다.
 */
export const POST = withErrors('auth/register', async (req) => {
  // 공개 경로 — 스크립트로 계정을 무더기로 만드는 것을 막는다.
  const rl = rateLimit(`register:${clientIp(req)}`, 5, 60 * 60 * 1000);
  if (!rl.ok) throw fail(429, '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');

  const body = await readJson(req);
  const email = str(body, 'email')?.trim().toLowerCase();
  const password = str(body, 'password');
  const displayName = str(body, 'displayName', { max: 100 });
  if (!email || !password) throw fail(400, '이메일과 비밀번호를 입력해주세요.');
  if (password.length < 6) throw fail(400, '비밀번호는 6자 이상이어야 합니다.');

  if (await prisma.user.findUnique({ where: { email } })) throw fail(409, '이미 등록된 이메일입니다.');

  const hashed = await bcrypt.hash(password, 12);
  const invitationToken = str(body, 'invitationToken', { max: 200 });
  const invitation = invitationToken ? await prisma.invitation.findFirst({ where: { token: invitationToken, email, status: 'pending' }, orderBy: { createdAt: 'desc' } }) : null;

  let role: UserRole = 'manager';
  let status = 'pending_invite';
  let propertyIds: string[] = [];
  let organizationId: string | null = null;
  const validInvitation = invitation && new Date(invitation.expiresAt) > new Date() ? invitation : null;
  if (invitationToken && !validInvitation) throw fail(400, '유효하지 않거나 만료된 초대 링크입니다.');

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    role = 'super_admin';
    status = 'active'; // First user ever → bootstrap
  } else if (validInvitation) {
    role = normalizeRole(validInvitation.role);
    if (role === 'super_admin') throw fail(403, '이 초대로 슈퍼매니저 권한을 발급할 수 없습니다.');
    organizationId = validInvitation.organizationId || null;
    if (role === 'admin' && !organizationId) throw fail(400, '사업자 소속이 지정되지 않은 초대입니다.');
    if (organizationId && !(await prisma.organization.findFirst({ where: { id: organizationId, status: 'active' }, select: { id: true } }))) throw fail(403, '사용이 중지된 사업자의 초대입니다.');
    status = 'active';
    propertyIds = role === 'manager' ? ((validInvitation.propertyIds as string[]) ?? []) : [];
    if (propertyIds.length && await prisma.property.count({ where: { id: { in: propertyIds }, organizationId } }) !== propertyIds.length) throw fail(403, '초대에 배정된 숙소의 소속이 변경되었습니다.');

  }

  const user = await prisma.$transaction(async tx => {
    if (validInvitation) {
      if (organizationId && !(await tx.organization.findFirst({ where: { id: organizationId, status: 'active' }, select: { id: true } }))) throw fail(403, '사용이 중지된 사업자의 초대입니다.');
      if (propertyIds.length && await tx.property.count({ where: { id: { in: propertyIds }, organizationId } }) !== propertyIds.length) throw fail(409, '배정 지점의 소속이 변경되었습니다. 관리자에게 초대 재발급을 요청해 주세요.');
      const claim = await tx.invitation.updateMany({ where: { id: validInvitation.id, token: invitationToken!, status: 'pending', expiresAt: { gt: new Date() } }, data: { status: 'accepted' } });
      if (claim.count !== 1) throw fail(409, '이미 사용했거나 만료된 초대입니다.');
    }
    // Link-only staff already have a User. Activate that row rather than create a second account.
    if (validInvitation?.cleanerId) {
      const existing = await tx.user.findUnique({ where: { id: validInvitation.cleanerId } });
      if (!existing || existing.status !== 'no_account' || normalizeRole(existing.role) !== role) throw fail(409, '이미 로그인이 활성화되었거나 역할이 변경된 직원입니다.');
      if ((existing.organizationId || null) !== organizationId) throw fail(403, '직원과 초대의 사업자가 일치하지 않습니다.');
      const activated = await tx.user.updateMany({ where: { id: existing.id, status: 'no_account', role: existing.role }, data: { email, password: hashed, status: 'active', displayName: displayName || existing.displayName || email } });
      if (activated.count !== 1) throw fail(409, '직원 로그인 상태가 변경되었습니다.');
      const saved = await tx.user.findUniqueOrThrow({ where: { id: existing.id } });
      await tx.auditLog.create({ data: auditData({ session: { userId: saved.id }, user: saved }, { action: 'invitation.accept', module: 'staff', targetType: 'user', targetId: saved.id, organizationId, summary: '청소 직원 초대 수락·로그인 활성화', details: { changedFields: ['status', 'role', 'organizationId'] } }) });
      return saved;
    }
    const saved = await tx.user.create({ data: { email, password: hashed, displayName: displayName || email, role, status,
      organizationId,
      ownerId: validInvitation?.invitedBy || null, publicToken: randomBytes(24).toString('base64url'),
    } });
    if (propertyIds.length) await tx.userProperty.createMany({ data: propertyIds.map(propertyId => ({ userId: saved.id, propertyId })) });
    await tx.auditLog.create({ data: auditData({ session: { userId: saved.id }, user: saved }, { action: validInvitation ? 'invitation.accept' : 'user.register', module: 'staff', targetType: 'user', targetId: saved.id, organizationId, summary: validInvitation ? '초대 수락·계정 생성' : '새 계정 등록', details: { changedFields: ['status', 'role', 'organizationId', 'propertyIds'] } }) });
    return saved;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') throw fail(409, '초대 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
    throw error;
  });
  propertyIds = (await prisma.userProperty.findMany({ where: { userId: user.id }, select: { propertyId: true } })).map(p => p.propertyId);

  await setSessionCookie(await signToken({ userId: user.id, email: user.email }));

  return ok({
    user: { id: user.id, email: user.email },
    profile: { role, propertyIds, organizationId, enabledModules: user.enabledModules, displayName: user.displayName || user.email, status: user.status },
  });
});
