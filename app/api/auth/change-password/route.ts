import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, readJson, str } from '@/lib/core/http';
import { setSessionCookie, signToken } from '@/lib/auth';

export const POST = withAuth('auth/change-password', async (req, { auth }) => {
  const body = await readJson(req);
  const currentPassword = str(body, 'currentPassword');
  const newPassword = str(body, 'newPassword');
  if (!currentPassword || !newPassword) throw fail(400, '현재 비밀번호와 새 비밀번호를 입력해주세요.');
  if (newPassword.length < 10 || Buffer.byteLength(newPassword, 'utf8') > 72) throw fail(400, '새 비밀번호는 10자 이상, UTF-8 기준 72바이트 이내로 입력해 주세요.');

  const valid = await bcrypt.compare(currentPassword, auth.user.password);
  if (!valid) throw fail(400, '현재 비밀번호가 올바르지 않습니다.');

  const credentialVersion = auth.user.credentialVersion ?? 0;
  const changed = await prisma.user.updateMany({ where: { id: auth.session.userId, password: auth.user.password, credentialVersion, status: 'active' },
    data: { password: await bcrypt.hash(newPassword, 12), credentialVersion: { increment: 1 } } });
  if (changed.count !== 1) throw fail(409, '로그인 정보가 변경되었습니다. 다시 로그인한 뒤 시도해 주세요.');
  await setSessionCookie(await signToken({ userId: auth.user.id, email: auth.user.email, credentialVersion: credentialVersion + 1 }));
  return ok({ ok: true });
});
