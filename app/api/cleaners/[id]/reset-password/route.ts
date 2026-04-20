import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';
import { lastFourDigits, phoneToSyntheticEmail } from '@/lib/phone';

/**
 * Idempotently ensure a cleaner has a phone-based login account.
 * - No linked user + phone present → creates User (email=synthetic, password=last4)
 * - Linked user → resets password back to last4
 * Requires admin. Returns the effective login identity (phone + last4 note).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!auth.isAdmin) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const { id } = await params;
    const cleaner = await prisma.cleaner.findUnique({
      where: { id },
      select: { id: true, name: true, phone: true, userId: true },
    });
    if (!cleaner) {
      return NextResponse.json({ error: '청소 담당자를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (!cleaner.phone) {
      return NextResponse.json({ error: '전화번호가 등록되어야 계정을 만들 수 있습니다.' }, { status: 400 });
    }

    const synthetic = phoneToSyntheticEmail(cleaner.phone);
    const last4 = lastFourDigits(cleaner.phone);
    if (!synthetic || !last4) {
      return NextResponse.json({ error: '전화번호 형식이 올바르지 않습니다.' }, { status: 400 });
    }

    const hashed = await bcrypt.hash(last4, 12);

    if (cleaner.userId) {
      await prisma.user.update({
        where: { id: cleaner.userId },
        data: { password: hashed, email: synthetic, phone: cleaner.phone, status: 'active' },
      });
      return NextResponse.json({ created: false, phone: cleaner.phone });
    }

    const user = await prisma.user.create({
      data: {
        email: synthetic,
        password: hashed,
        displayName: cleaner.name,
        phone: cleaner.phone,
        role: 'cleaner',
        status: 'active',
      },
    });
    await prisma.cleaner.update({ where: { id }, data: { userId: user.id } });

    return NextResponse.json({ created: true, phone: cleaner.phone });
  } catch (e) {
    console.error('[cleaners/reset-password] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
