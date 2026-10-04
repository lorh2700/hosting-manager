import { prisma } from '@/lib/prisma';
import { withErrors, withAuth, ok, fail } from '@/lib/core/http';
import { revokeInvitation } from '@/lib/invitation-lifecycle';

/** Public endpoint — look up a pending invitation by token */
export const GET = withErrors<{ token: string }>('invitations/token', async (_req, { params }) => {
  const invitation = await prisma.invitation.findUnique({ where: { token: params.token }, include: { organization: { select: { name: true } } } });
  if (!invitation || invitation.status !== 'pending') throw fail(404, '유효하지 않거나 만료된 초대 링크입니다.');
  if (new Date(invitation.expiresAt) < new Date()) throw fail(410, '초대 링크가 만료되었습니다.');

  const propertyIds = Array.isArray(invitation.propertyIds) ? invitation.propertyIds.filter((id): id is string => typeof id === 'string') : [];
  const properties = propertyIds.length ? await prisma.property.findMany({ where: { id: { in: propertyIds }, organizationId: invitation.organizationId }, select: { name: true }, take: 200 }) : [];
  return ok({ id: invitation.id, email: invitation.email, role: invitation.role, organizationName: invitation.organization?.name ?? null, propertyNames: properties.map(item => item.name), status: invitation.status, expiresAt: invitation.expiresAt.toISOString() });
});

export const DELETE = withAuth<{ token: string }>('invitations/revoke', async (_req, { auth, params }) => ok(await revokeInvitation(auth, params.token)), { businessAdmin: true, audit: false });
