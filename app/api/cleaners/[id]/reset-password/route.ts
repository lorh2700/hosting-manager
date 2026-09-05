import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail } from '@/lib/core/http';
import { lastFourDigits, phoneToSyntheticEmail } from '@/lib/phone';

type Params = { id: string };

/**
 * Idempotently ensure a cleaner has a phone-based login account.
 * - No linked user + phone present → creates User (email=synthetic, password=last4)
 * - Linked user → resets password back to last4
 * Requires admin. Returns the effective login identity.
 */
export const POST = withAuth<Params>('cleaners/reset-password', async (_req, { params }) => {
  const cleaner = await prisma.cleaner.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, phone: true, userId: true },
  });
  if (!cleaner) throw fail(404, '청소 담당자를 찾을 수 없습니다.');
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

  const user = await prisma.user.create({
    data: { email: synthetic, password: hashed, displayName: cleaner.name, phone: cleaner.phone, role: 'cleaner', status: 'active' },
  });
  await prisma.cleaner.update({ where: { id: params.id }, data: { userId: user.id } });
  return ok({ created: true, phone: cleaner.phone });
}, { admin: true });
