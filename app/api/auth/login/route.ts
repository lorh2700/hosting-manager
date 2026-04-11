import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken, setSessionCookie } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: '이메일과 비밀번호를 입력해주세요.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
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
