import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const me = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!me || !['super_admin', 'admin'].includes(me.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    if (id === session.userId) {
      return NextResponse.json({ error: '자기 자신은 삭제할 수 없습니다.' }, { status: 400 });
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await prisma.user.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[users/:id] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
