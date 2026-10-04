import { withAuth, fail, requireManage } from '@/lib/core/http';
import { prisma } from '@/lib/prisma';
import { privateStayResponse, requireStayOrigin } from '@/lib/guest-stay-store';
export const DELETE = withAuth<{ id: string }>('guest-stays/devices/revoke', async (req, { auth, params }) => {
  requireStayOrigin(req);
  const device = await prisma.guestStayDevice.findUnique({ where: { id: params.id }, select: { propertyId: true } });
  if (!device) throw fail(404, '패드 연결을 찾을 수 없습니다.');
  requireManage(auth, device.propertyId);
  await prisma.$transaction(async tx => {
    await tx.guestStayDevice.update({ where: { id: params.id }, data: { revokedAt: new Date(), pairingHash: null } });
    await tx.guestStayAccess.updateMany({ where: { deviceId: params.id, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  return privateStayResponse({ ok: true });
});
