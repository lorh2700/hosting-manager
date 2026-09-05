import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken, setSessionCookie } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/rateLimit';

export async function POST(req: Request) {
  try {
    // 공개 경로 — 스크립트로 계정을 무더기로 만드는 것을 막는다.
    const rl = rateLimit(`register:${clientIp(req)}`, 5, 60 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const { email, password, displayName } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: '이메일과 비밀번호를 입력해주세요.' }, { status: 400 });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return NextResponse.json({ error: '비밀번호는 6자 이상이어야 합니다.' }, { status: 400 });
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

    // Cleaner-first: if the invitation targets a specific Cleaner record,
    // link it to this user instead of creating a new one. This is the
    // expected path — admins add cleaners first, then invite them to the
    // portal. Fallback auto-create remains for legacy invitations and the
    // bootstrap edge case (no invitation + first-user=cleaner).
    if (user.role === 'cleaner') {
      if (invitation?.cleanerId) {
        await prisma.cleaner.update({
          where: { id: invitation.cleanerId },
          data: { userId: user.id },
        });
      } else {
        const ownerId = invitation?.invitedBy
          ?? (await prisma.user.findFirst({
            where: { role: { in: ['super_admin', 'admin'] } },
            select: { id: true },
          }))?.id;

        if (ownerId) {
          await prisma.cleaner.create({
            data: {
              userId: user.id,
              name: user.displayName || user.email,
              ownerId,
              publicToken: randomBytes(24).toString('base64url'),
            },
          });
        } else {
          console.warn('[register] no admin found to own cleaner record for', user.email);
        }
      }
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
