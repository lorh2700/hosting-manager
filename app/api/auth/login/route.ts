import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken, setSessionCookie } from '@/lib/auth';
import { phoneToSyntheticEmail } from '@/lib/phone';
import { rateLimit, clientIp } from '@/lib/rateLimit';

export async function POST(req: Request) {
  try {
    // 청소매니저 계정은 전화번호 뒤 4자리가 비밀번호라 무차별 대입에 특히 약하다.
    const rl = rateLimit(`login:${clientIp(req)}`, 10, 10 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const { email, phone, password } = await req.json();

    if (!password || (!email && !phone)) {
      return NextResponse.json({ error: '이메일 또는 전화번호와 비밀번호를 입력해주세요.' }, { status: 400 });
    }

    // Phone login resolves to the synthetic email used by the cleaner's
    // auto-created User account.
    const lookupEmail = email ?? (phone ? phoneToSyntheticEmail(phone) : null);
    if (!lookupEmail) {
      return NextResponse.json({ error: '전화번호 형식이 올바르지 않습니다.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email: lookupEmail },
      include: { properties: true },
    });

    if (!user) {
      return NextResponse.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return NextResponse.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }

    if (user.status === 'suspended') {
      return NextResponse.json({ error: '계정이 비활성화되었습니다.' }, { status: 403 });
    }

    // Update lastLoginAt
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await signToken({ userId: user.id, email: user.email });
    await setSessionCookie(token);

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      profile: {
        role: user.role,
        propertyIds: user.properties.map((p) => p.propertyId),
        displayName: user.displayName || user.email,
        phone: user.phone,
        status: user.status,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: '로그인에 실패했습니다.' }, { status: 500 });
  }
}
