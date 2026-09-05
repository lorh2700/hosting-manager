import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail } from '@/lib/core/http';

type Params = { id: string };

// DELETE = revoke (soft) — 키 자체는 보존해 감사 로그/last_used_at 추적 유지.
export const DELETE = withAuth<Params>('admin/api-clients', async (_req, { params }) => {
  try {
    await prisma.apiClient.update({ where: { id: params.id }, data: { revokedAt: new Date() } });
  } catch {
    throw fail(404, 'Not found');
  }
  return ok({ ok: true });
}, { admin: true });
