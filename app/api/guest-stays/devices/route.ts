import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withAuth, fail, requireManage } from '@/lib/core/http';
import { prisma } from '@/lib/prisma';
import { cleanupGuestStayData, guestStayHash, newStayCode, normalizeStayCode, privateStayResponse, readStayJson, requireStayOrigin } from '@/lib/guest-stay-store';
const schema = z.object({ propertyId: z.string().min(1).max(128), label: z.string().trim().min(1).max(80) }).strict();
export const POST = withAuth('guest-stays/devices', async (req, { auth }) => {
  requireStayOrigin(req);
  const input = schema.safeParse(await readStayJson(req));
  if (!input.success) throw fail(400, '숙소와 패드 이름을 확인해 주세요.');
  requireManage(auth, input.data.propertyId);
  const property = await prisma.property.findUnique({ where: { id: input.data.propertyId }, select: { id: true, status: true } });
  if (!property || property.status !== 'active') throw fail(404, '운영 중인 숙소를 확인해 주세요.');
  await cleanupGuestStayData();
  const count = await prisma.guestStayDevice.count({ where: { propertyId: property.id, revokedAt: null, expiresAt: { gt: new Date() },
    OR: [{ pairedAt: { not: null } }, { pairingExpiresAt: { gt: new Date() } }] } });
  if (count >= 20) throw fail(400, '사용하지 않는 패드 연결을 해제해 주세요.');
  const pairingCode = newStayCode(), pairingExpiresAt = new Date(Date.now() + 10 * 60000), expiresAt = new Date(Date.now() + 180 * 86400000);
  const device = await prisma.guestStayDevice.create({ data: { id: randomUUID(), propertyId: property.id, label: input.data.label,
    pairingHash: guestStayHash(normalizeStayCode(pairingCode)), pairingExpiresAt, expiresAt, createdBy: auth.session.userId } });
  return privateStayResponse({ id: device.id, pairingCode, expiresAt: pairingExpiresAt.toISOString() }, 201);
});
