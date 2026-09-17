import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail } from '@/lib/core/http';
import { normalizeRole } from '@/lib/access';
import { phoneToSyntheticEmail } from '@/lib/phone';
export const POST = withAuth<{ id: string }>('staff/reset-password', async (_req, { auth, params }) => {
  const user = await prisma.user.findUnique({ where: { id: params.id } });
  if (!user) throw fail(404, '직원을 찾을 수 없습니다.');
  if (auth.role !== 'admin' && !(auth.role === 'manager' && normalizeRole(user.role) === 'cleaner' && user.ownerId === auth.session.userId)) throw fail(403, '권한이 없습니다.');
  if (user.id === auth.session.userId) throw fail(400, '본인 비밀번호는 비밀번호 변경에서 수정해 주세요.');
  const initialPassword = randomBytes(12).toString('hex');
  const email = user.email.endsWith('@staff.invalid') ? phoneToSyntheticEmail(user.phone || '') : user.email;
  if (!email) throw fail(400, '로그인에 사용할 전화번호를 먼저 등록해 주세요.');
  const conflict = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (conflict && conflict.id !== user.id) throw fail(409, '같은 로그인 번호의 계정이 있습니다.');
  await prisma.user.update({ where: { id: user.id }, data: { email, password: await bcrypt.hash(initialPassword, 12), status: 'active' } });
  return ok({ created: user.status === 'no_account', phone: user.phone, initialPassword });
});
