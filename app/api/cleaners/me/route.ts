import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const cleaner = await prisma.cleaner.findUnique({
      where: { userId: session.userId },
    });
    if (!cleaner) return NextResponse.json({ cleaner: null });

    return NextResponse.json({ cleaner });
  } catch (e) {
    console.error('[cleaners/me] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
