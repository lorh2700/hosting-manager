import { withAuth, fail, requireManage } from '@/lib/core/http';
import { prisma } from '@/lib/prisma';
import { privateStayResponse, requireStayOrigin } from '@/lib/guest-stay-store';
export const DELETE = withAuth<{ id: string }>('guest-stays/access/revoke', async (req, { auth, params }) => {
  requireStayOrigin(req);
  const access = await prisma.guestStayAccess.findUnique({ where: { id: params.id }, select: { propertyId: true, reservationKind: true, reservationId: true } });
  if (!access) throw fail(404, '접근 정보를 찾을 수 없습니다.');
  requireManage(auth, access.propertyId);
  // Cancel every grant for this reservation so pad/invitation sessions are also invalidated.
  await prisma.guestStayAccess.updateMany({ where: { ...access, revokedAt: null }, data: { revokedAt: new Date() } });
  return privateStayResponse({ ok: true });
});
