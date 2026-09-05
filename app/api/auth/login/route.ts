import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken, setSessionCookie } from '@/lib/auth';
import { normalizeRole } from '@/lib/access';
import { phoneToSyntheticEmail } from '@/lib/phone';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { withErrors, ok, fail, readJson, str } from '@/lib/core/http';

export const POST = withErrors('auth/login', async (req) => {
  // 청소매니저 계정은 전화번호 뒤 4자리가 비밀번호라 무차별 대입에 특히 약하다.
  const rl = rateLimit(`login:${clientIp(req)}`, 10, 10 * 60 * 1000);
  if (!rl.ok) throw fail(429, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.');

  const body = await readJson(req);
  const email = str(body, 'email');
  const phone = str(body, 'phone');
  const password = str(body, 'password');
  if (!password || (!email && !phone)) throw fail(400, '이메일 또는 전화번호와 비밀번호를 입력해주세요.');

  // Phone login resolves to the synthetic email used by the cleaner's auto-created User account.
  const lookupEmail = email ?? (phone ? phoneToSyntheticEmail(phone) : null);
  if (!lookupEmail) throw fail(400, '전화번호 형식이 올바르지 않습니다.');

  const user = await prisma.user.findUnique({ where: { email: lookupEmail }, include: { properties: true } });
  if (!user || !(await bcrypt.compare(password, user.password))) throw fail(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
  if (user.status === 'suspended') throw fail(403, '계정이 비활성화되었습니다.');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await setSessionCookie(await signToken({ userId: user.id, email: user.email }));

  return ok({
    user: { id: user.id, email: user.email },
    profile: {
      role: normalizeRole(user.role),
      propertyIds: user.properties.map((p) => p.propertyId),
      displayName: user.displayName || user.email,
      phone: user.phone,
      status: user.status,
    },
  });
});
