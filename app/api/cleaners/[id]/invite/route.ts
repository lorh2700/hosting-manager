import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

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
    const body = await req.json();
    const { email, propertyIds } = body as { email: string; propertyIds?: string[] };

    if (!email) {
      return NextResponse.json({ error: '이메일은 필수입니다.' }, { status: 400 });
    }

    const cleaner = await prisma.cleaner.findUnique({
      where: { id },
      select: { id: true, userId: true, ownerId: true },
    });
    if (!cleaner) {
      return NextResponse.json({ error: '청소 담당자를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (cleaner.userId) {
      return NextResponse.json({ error: '이미 포털 계정과 연결된 담당자입니다.' }, { status: 409 });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: '이미 가입된 이메일입니다.' }, { status: 409 });
    }

    const existingInvite = await prisma.invitation.findFirst({
      where: { email, status: 'pending' },
    });
    if (existingInvite) {
      return NextResponse.json({ error: '이미 대기중인 초대가 있습니다.' }, { status: 409 });
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invitation = await prisma.invitation.create({
      data: {
        email,
        role: 'cleaner',
        propertyIds: propertyIds ?? [],
        invitedBy: auth.session.userId,
        cleanerId: cleaner.id,
        status: 'pending',
        token: generateToken(),
        expiresAt,
      },
    });

    return NextResponse.json(
      { ...invitation, inviteLink: `/invite/${invitation.token}` },
      { status: 201 }
    );
  } catch (e) {
    console.error('[cleaners/invite] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
