import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';
import type { UserRole } from '@/lib/types';

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function verifyAdmin(req: Request): Promise<{ userId: string; role: string } | null> {
  const session = await verifySession(req);
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !['super_admin', 'admin'].includes(user.role)) return null;
  return { userId: user.id, role: user.role };
}

export async function GET(req: Request) {
  try {
    const admin = await verifyAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const invitations = await prisma.invitation.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json(invitations);
  } catch (e) {
    console.error('[invitations] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await verifyAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const body = await req.json();
    const { email, role, propertyIds } = body as {
      email: string;
      role: UserRole;
      propertyIds: string[];
    };

    if (!email || !role) {
      return NextResponse.json({ error: '이메일과 역할은 필수입니다.' }, { status: 400 });
    }

    if (!['admin', 'host', 'cleaner', 'viewer'].includes(role)) {
      return NextResponse.json({ error: '유효하지 않은 역할입니다.' }, { status: 400 });
    }

    const existing = await prisma.invitation.findFirst({
      where: { email, status: 'pending' },
    });
    if (existing) {
      return NextResponse.json({ error: '이미 대기중인 초대가 있습니다.' }, { status: 409 });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const token = generateToken();

    const invitation = await prisma.invitation.create({
      data: {
        email,
        role,
        propertyIds: propertyIds ?? [],
        invitedBy: admin.userId,
        status: 'pending',
        token,
        expiresAt,
      },
    });

    return NextResponse.json({
      ...invitation,
      inviteLink: `/invite/${invitation.token}`,
    }, { status: 201 });
  } catch (e) {
    console.error('[invitations] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
