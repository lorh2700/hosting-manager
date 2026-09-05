import { prisma } from '@/lib/prisma';
import { normalizeRole } from '@/lib/access';
import { withAuth, ok, fail, MESSAGES } from '@/lib/core/http';

type Params = { id: string };

/**
 * 계정 삭제 (관리자). 청소담당자 로그인 계정은 프로필과 함께 청소 담당자 화면에서 지운다 —
 * 여기서 지우면 Cleaner 행만 남아 "로그인 없는 담당자"가 되어 버린다.
 */
export const DELETE = withAuth<Params>('users/id', async (_req, { auth, params }) => {
  if (params.id === auth.session.userId) throw fail(400, '자기 자신은 삭제할 수 없습니다.');

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) throw fail(404, MESSAGES.notFound);
  if (normalizeRole(target.role) === 'cleaner') throw fail(400, '청소담당자 계정은 청소 담당자 관리에서 삭제합니다.');

  await prisma.user.delete({ where: { id: params.id } });
  return ok({ ok: true });
}, { admin: true });
