import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken, setSessionCookie } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { withErrors, ok, fail, readJson, str } from '@/lib/core/http';

/**
 * 회원가입. 초대(Invitation)가 있으면 그 역할로 활성화, 없으면 승인 대기(pending_invite).
 * 첫 사용자는 부트스트랩을 위해 자동 활성화된다. 승인 대기 계정은 세션은 받지만 API 는 쓸 수 없다.
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

  let role = 'host';
  let status = 'pending_invite';
  let propertyIds: string[] = [];

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    status = 'active'; // First user ever → bootstrap
  } else if (invitation && new Date(invitation.expiresAt) > new Date()) {
    role = invitation.role;
    status = 'active';
    propertyIds = (invitation.propertyIds as string[]) ?? [];
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'accepted' } });
  }

  const user = await prisma.user.create({ data: { email, password: hashed, displayName: displayName || email, role, status } });

  if (propertyIds.length > 0) {
    await prisma.userProperty.createMany({ data: propertyIds.map((pid) => ({ userId: user.id, propertyId: pid })) });
  }

  // Cleaner-first: an invitation that targets a specific Cleaner links it instead of creating a new one.
  if (user.role === 'cleaner') {
    if (invitation?.cleanerId) {
      await prisma.cleaner.update({ where: { id: invitation.cleanerId }, data: { userId: user.id } });
    } else {
      const ownerId = invitation?.invitedBy
        ?? (await prisma.user.findFirst({ where: { role: { in: ['super_admin', 'admin'] } }, select: { id: true } }))?.id;
      if (ownerId) {
        await prisma.cleaner.create({
          data: { userId: user.id, name: user.displayName || user.email, ownerId, publicToken: randomBytes(24).toString('base64url') },
        });
      } else {
        console.warn('[register] no admin found to own cleaner record for', user.email);
      }
    }
  }

  await setSessionCookie(await signToken({ userId: user.id, email: user.email }));

  return ok({
    user: { id: user.id, email: user.email },
    profile: { role: user.role, propertyIds, displayName: user.displayName || user.email, status: user.status },
  });
});
