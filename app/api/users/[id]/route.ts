import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, MESSAGES } from '@/lib/core/http';

type Params = { id: string };

export const DELETE = withAuth<Params>('users/id', async (_req, { auth, params }) => {
  if (params.id === auth.session.userId) throw fail(400, '자기 자신은 삭제할 수 없습니다.');

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) throw fail(404, MESSAGES.notFound);
  // super_admin 계정은 super_admin 만 삭제할 수 있다.
  if (target.role === 'super_admin' && auth.user.role !== 'super_admin') throw fail(403, MESSAGES.forbidden);

  await prisma.user.delete({ where: { id: params.id } });
  return ok({ ok: true });
}, { admin: true });
