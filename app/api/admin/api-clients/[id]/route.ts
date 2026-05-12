import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

async function requireSuperAdmin(req: Request) {
  const session = await verifySession(req);
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !['super_admin', 'admin'].includes(user.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user };
}

// DELETE = revoke (soft) — 키 자체는 보존해 감사 로그/last_used_at 추적 유지.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin(req);
  if ('error' in guard) return guard.error;

  const { id } = await ctx.params;
  try {
    await prisma.apiClient.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
