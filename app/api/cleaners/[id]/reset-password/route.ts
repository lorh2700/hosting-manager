import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { canManageCleaner } from '@/lib/access';
import { withAuth, ok, fail, MESSAGES } from '@/lib/core/http';
import { lastFourDigits, phoneToSyntheticEmail } from '@/lib/phone';

type Params = { id: string };

/**
 * 전화번호 로그인 계정을 만들거나(없을 때) 비밀번호를 뒷 4자리로 되돌린다(있을 때).
 * 계정 생성은 이 경로에서만 일어난다 — 프로필을 만든다고 자동으로 생기지 않는다.
 */
export const POST = withAuth<Params>('cleaners/reset-password', async (_req, { auth, params }) => {
  const cleaner = await prisma.cleaner.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, phone: true, userId: true, ownerId: true },
  });
  if (!cleaner) throw fail(404, '청소 담당자를 찾을 수 없습니다.');
  if (!canManageCleaner(auth, cleaner)) throw fail(403, MESSAGES.forbidden);
  if (!cleaner.phone) throw fail(400, '전화번호가 등록되어야 계정을 만들 수 있습니다.');

  const synthetic = phoneToSyntheticEmail(cleaner.phone);
  const last4 = lastFourDigits(cleaner.phone);
  if (!synthetic || !last4) throw fail(400, '전화번호 형식이 올바르지 않습니다.');

  const hashed = await bcrypt.hash(last4, 12);

  if (cleaner.userId) {
    await prisma.user.update({
      where: { id: cleaner.userId },
      data: { password: hashed, email: synthetic, phone: cleaner.phone, status: 'active' },
    });
    return ok({ created: false, phone: cleaner.phone });
  }

  // 같은 합성 이메일의 계정이 이미 있으면(예전 자동 생성 잔재) 새로 만들지 않고 연결한다.
  const existing = await prisma.user.findUnique({ where: { email: synthetic }, select: { id: true } });
  const userId = existing
    ? (await prisma.user.update({ where: { id: existing.id }, data: { password: hashed, phone: cleaner.phone, role: 'cleaner', status: 'active' } })).id
    : (await prisma.user.create({
        data: { email: synthetic, password: hashed, displayName: cleaner.name, phone: cleaner.phone, role: 'cleaner', status: 'active' },
      })).id;
  await prisma.cleaner.update({ where: { id: params.id }, data: { userId } });
  return ok({ created: true, phone: cleaner.phone });
});
