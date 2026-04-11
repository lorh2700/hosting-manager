import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken, setSessionCookie } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { email, password, displayName } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: '이메일과 비밀번호를 입력해주세요.' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: '이미 등록된 이메일입니다.' }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password, 12);

    // Check for pending invitation
    const invitation = await prisma.invitation.findFirst({
      where: { email, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });

    let role = 'host';
    let status = 'pending_invite';
    let propertyIds: string[] = [];

    // First user ever → auto-activate (bootstrap)
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      status = 'active';
    } else if (invitation && new Date(invitation.expiresAt) > new Date()) {
      role = invitation.role;
      status = 'active';
      propertyIds = (invitation.propertyIds as string[]) ?? [];
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted' },
      });
    }

    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        displayName: displayName || email,
        role,
        status,
      },
    });

    // Create user-property links
    if (propertyIds.length > 0) {
      await prisma.userProperty.createMany({
        data: propertyIds.map((pid) => ({ userId: user.id, propertyId: pid })),
      });
    }

    const token = await signToken({ userId: user.id, email: user.email });
    await setSessionCookie(token);

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      profile: {
        role: user.role,
        propertyIds,
        displayName: user.displayName || user.email,
        status: user.status,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    return NextResponse.json({ error: '회원가입에 실패했습니다.' }, { status: 500 });
  }
}
