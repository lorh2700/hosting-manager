import QRCode from 'qrcode';
import { prisma } from '@/lib/prisma';
import { withAuth, requireManage, requireQuery, ok, fail } from '@/lib/core/http';
import { checkoutQrToken } from '@/lib/checkout-qr';

export const GET = withAuth('checkout/qr', async (req, { auth }) => {
  const propertyId = requireQuery(req, 'propertyId');
  requireManage(auth, propertyId);
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true } });
  if (!property) throw fail(404, '숙소를 찾을 수 없습니다.');
  const origin = new URL(process.env.CHECKOUT_SITE_URL || process.env.URL || req.url).origin;
  const url = `${origin}/guest-checkout#${checkoutQrToken(property.id)}`;
  const image = await QRCode.toDataURL(url, { width: 900, margin: 4, errorCorrectionLevel: 'M' });
  const response = ok({ propertyName: property.name, url, image });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
});
