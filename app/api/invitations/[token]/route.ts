import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/** Public endpoint — look up a pending invitation by token */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const invitation = await prisma.invitation.findUnique({ where: { token } });

  if (!invitation || invitation.status !== 'pending') {
    return NextResponse.json({ error: '유효하지 않거나 만료된 초대 링크입니다.' }, { status: 404 });
  }

  if (new Date(invitation.expiresAt) < new Date()) {
    return NextResponse.json({ error: '초대 링크가 만료되었습니다.' }, { status: 410 });
  }

  return NextResponse.json({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
  });
}
