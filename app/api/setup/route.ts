import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function POST(req: Request) {
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: '로그인 상태가 아닙니다.' }, { status: 401 });
  }

  // Check if any super_admin already exists
  const existing = await prisma.user.findFirst({ where: { role: 'super_admin' } });
  if (existing) {
    return NextResponse.json({ error: '이미 super_admin 계정이 존재합니다.' }, { status: 409 });
  }

  // Check for legacy admin
  const legacyAdmin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (legacyAdmin) {
    return NextResponse.json({ error: '기존 admin 계정이 존재합니다.' }, { status: 409 });
  }

  const user = await prisma.user.update({
    where: { id: session.userId },
    data: { role: 'super_admin' },
  });

  return NextResponse.json({
    message: `완료! ${user.email} 계정이 super_admin으로 설정되었습니다.`,
    email: user.email,
  });
}
