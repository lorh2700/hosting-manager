import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken, setSessionCookie } from '@/lib/auth';
import { normalizeRole } from '@/lib/access';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { withErrors, ok, fail, readJson, str } from '@/lib/core/http';
import type { UserRole } from '@/lib/types';

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
  const email = str(body, 'email')?.trim();
  const password = str(body, 'password');
  const displayName = str(body, 'displayName', { max: 100 });
  if (!email || !password) throw fail(400, '이메일과 비밀번호를 입력해주세요.');
  if (password.length < 6) throw fail(400, '비밀번호는 6자 이상이어야 합니다.');

  if (await prisma.user.findUnique({ where: { email } })) throw fail(409, '이미 등록된 이메일입니다.');

  const hashed = await bcrypt.hash(password, 12);
  const invitation = await prisma.invitation.findFirst({ where: { email, status: 'pending' }, orderBy: { createdAt: 'desc' } });

  let role: UserRole = 'manager';
  let status = 'pending_invite';
  let propertyIds: string[] = [];
  const validInvitation = invitation && new Date(invitation.expiresAt) > new Date() ? invitation : null;

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    role = 'admin';
    status = 'active'; // First user ever → bootstrap
  } else if (validInvitation) {
    role = normalizeRole(validInvitation.role);
    status = 'active';
    propertyIds = role === 'manager' ? ((validInvitation.propertyIds as string[]) ?? []) : [];

  }

  const user = await prisma.$transaction(async tx => {
    if (validInvitation) {
      const claim = await tx.invitation.updateMany({ where: { id: validInvitation.id, status: 'pending', expiresAt: { gt: new Date() } }, data: { status: 'accepted' } });
      if (claim.count !== 1) throw fail(409, '이미 사용했거나 만료된 초대입니다.');
    }
    // Link-only staff already have a User. Activate that row rather than create a second account.
    if (validInvitation?.cleanerId) {
      const existing = await tx.user.findUnique({ where: { id: validInvitation.cleanerId } });
      if (!existing || existing.status !== 'no_account' || normalizeRole(existing.role) !== role) throw fail(409, '이미 로그인이 활성화되었거나 역할이 변경된 직원입니다.');
      const activated = await tx.user.updateMany({ where: { id: existing.id, status: 'no_account', role: existing.role }, data: { email, password: hashed, status: 'active', displayName: displayName || existing.displayName || email } });
      if (activated.count !== 1) throw fail(409, '직원 로그인 상태가 변경되었습니다.');
      return tx.user.findUniqueOrThrow({ where: { id: existing.id } });
    }
    const saved = await tx.user.create({ data: { email, password: hashed, displayName: displayName || email, role, status,
      ownerId: validInvitation?.invitedBy || null, publicToken: randomBytes(24).toString('base64url'),
    } });
    if (propertyIds.length) await tx.userProperty.createMany({ data: propertyIds.map(propertyId => ({ userId: saved.id, propertyId })) });
    return saved;
  });
  propertyIds = (await prisma.userProperty.findMany({ where: { userId: user.id }, select: { propertyId: true } })).map(p => p.propertyId);

  await setSessionCookie(await signToken({ userId: user.id, email: user.email }));

  return ok({
    user: { id: user.id, email: user.email },
    profile: { role, propertyIds, displayName: user.displayName || user.email, status: user.status },
  });
});
