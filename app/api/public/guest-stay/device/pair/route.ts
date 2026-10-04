import { withErrors, fail } from '@/lib/core/http';
import { prisma } from '@/lib/prisma';
import { guestStayHash, newStayToken, normalizeStayCode, privateStayResponse, readStayJson, stayProperty, throttleStayAttempt } from '@/lib/guest-stay-store';
export const POST = withErrors('guest-stay/device/pair', async req => {
  const body = await readStayJson(req);
  if (typeof body.slug !== 'string' || !/^[a-z0-9_-]{1,60}$/.test(body.slug) || typeof body.pairingCode !== 'string' || body.pairingCode.length > 40) throw fail(400, '패드 연결 정보를 확인해 주세요.');
  await throttleStayAttempt(req, 'device-pair', 12);
  const property = await stayProperty(body.slug);
  const hash = guestStayHash(normalizeStayCode(body.pairingCode));
  const device = await prisma.guestStayDevice.findUnique({ where: { pairingHash: hash } });
  if (!property || !device || device.propertyId !== property.id || device.pairedAt || device.revokedAt || device.pairingExpiresAt.getTime() <= Date.now()) throw fail(401, '연결 코드가 만료되었거나 올바르지 않습니다.', { code: 'invalid_pairing_code' });
  const token = `gst_device_${newStayToken()}`;
  const updated = await prisma.guestStayDevice.updateMany({ where: { id: device.id, pairingHash: hash, pairedAt: null,
    revokedAt: null, pairingExpiresAt: { gt: new Date() } }, data: { tokenHash: guestStayHash(token), pairedAt: new Date(), pairingHash: null } });
  if (updated.count !== 1) throw fail(409, '이 연결 코드는 이미 사용되었습니다.');
  // No guest name or stay details are returned from the exchange.
  return privateStayResponse({ deviceToken: token, device: { id: device.id, label: device.label, expiresAt: device.expiresAt.toISOString() } });
});
