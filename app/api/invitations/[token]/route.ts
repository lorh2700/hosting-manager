import { prisma } from '@/lib/prisma';
import { withErrors, ok, fail } from '@/lib/core/http';

/** Public endpoint — look up a pending invitation by token */
export const GET = withErrors<{ token: string }>('invitations/token', async (_req, { params }) => {
  const invitation = await prisma.invitation.findUnique({ where: { token: params.token } });
  if (!invitation || invitation.status !== 'pending') throw fail(404, '유효하지 않거나 만료된 초대 링크입니다.');
  if (new Date(invitation.expiresAt) < new Date()) throw fail(410, '초대 링크가 만료되었습니다.');

  return ok({ id: invitation.id, email: invitation.email, role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt.toISOString() });
});
