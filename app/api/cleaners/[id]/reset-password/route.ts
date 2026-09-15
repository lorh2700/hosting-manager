import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { canManageCleaner, normalizeRole } from '@/lib/access';
import { withAuth, ok, fail, MESSAGES } from '@/lib/core/http';
import { phoneToSyntheticEmail } from '@/lib/phone';

type Params = { id: string };
export const POST = withAuth<Params>('cleaners/reset-password', async (_req, { auth, params }) => {
  const cleaner = await prisma.cleaner.findUnique({ where: { id: params.id }, select: { id: true, name: true, phone: true, userId: true, ownerId: true } });
  if (!cleaner) throw fail(404, '청소 담당자를 찾을 수 없습니다.');
  if (!canManageCleaner(auth, cleaner)) throw fail(403, MESSAGES.forbidden);
  if (!cleaner.phone) throw fail(400, '휴대폰 번호를 먼저 등록해 주세요.');
  const email = phoneToSyntheticEmail(cleaner.phone);
  if (!email) throw fail(400, '전화번호 형식이 올바르지 않습니다.');
  const linked = cleaner.userId ? await prisma.user.findUnique({ where: { id: cleaner.userId } }) : null;
  if (linked && normalizeRole(linked.role) !== 'cleaner') throw fail(400, '청소 전용 계정이 아닙니다. 관리자에게 계정 연결을 확인해 주세요.');
  if (!linked && await prisma.user.findUnique({ where: { email }, select: { id: true } })) throw fail(409, '기존 계정이 있습니다. 자동으로 연결하지 않습니다.');
  const initialPassword = randomBytes(12).toString('hex');
  const password = await bcrypt.hash(initialPassword, 12);
  await prisma.$transaction(async tx => {
    if (linked) await tx.user.update({ where: { id: linked.id }, data: { password, status: 'active' } });
    else {
      const user = await tx.user.create({ data: { email, password, displayName: cleaner.name, phone: cleaner.phone, role: 'cleaner', status: 'active' } });
      await tx.cleaner.update({ where: { id: cleaner.id }, data: { userId: user.id } });
    }
  });
  return ok({ created: !linked, phone: cleaner.phone, initialPassword });
});