import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, readJson, str } from '@/lib/core/http';

export const POST = withAuth('auth/change-password', async (req, { auth }) => {
  const body = await readJson(req);
  const currentPassword = str(body, 'currentPassword');
  const newPassword = str(body, 'newPassword');
  if (!currentPassword || !newPassword) throw fail(400, '현재 비밀번호와 새 비밀번호를 입력해주세요.');
  if (newPassword.length < 6) throw fail(400, '새 비밀번호는 6자 이상이어야 합니다.');

  const valid = await bcrypt.compare(currentPassword, auth.user.password);
  if (!valid) throw fail(400, '현재 비밀번호가 올바르지 않습니다.');

  await prisma.user.update({ where: { id: auth.session.userId }, data: { password: await bcrypt.hash(newPassword, 12) } });
  return ok({ ok: true });
});
