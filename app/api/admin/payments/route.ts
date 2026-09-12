import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, requireManage, readJson } from '@/lib/core/http';
import { reconcileCheckout, requestRefund } from '@/lib/payments/checkout';
export const maxDuration = 60;
export const GET = withAuth('admin/payments', async (_req, { auth }) => {
  if (auth.role === 'cleaner') throw fail(403, 'Forbidden');
  const properties = await prisma.property.findMany({ where: auth.isAdmin ? {} : { id: { in: auth.propertyIds ?? [] } }, select: { id: true } });
  return ok(await prisma.checkoutOrder.findMany({ where: { propertyId: { in: properties.map(p => p.id) } },
    orderBy: { createdAt: 'desc' }, take: 100,
    select: { id: true, propertyName: true, name: true, checkIn: true, checkOut: true, status: true, gateway: true,
      currency: true, amountMinor: true, mode: true, lastError: true, createdAt: true, beds24Id: true },
  }));
});
export const POST = withAuth('admin/payments', async (req, { auth }) => {
  const body = await readJson(req);
  const order = await prisma.checkoutOrder.findUnique({ where: { id: String(body.orderId ?? '') } });
  if (!order) throw fail(404, '결제를 찾을 수 없습니다.');
  requireManage(auth, order.propertyId);
  if (body.action === 'refund' && body.confirmFullRefund === true) {
    const result = await requestRefund(order.id);
    return ok({ status: result.status });
  }
  if (body.action === 'reconcile') return ok({ status: (await reconcileCheckout(order.id)).status });
  throw fail(400, '처리할 작업을 확인해주세요.');
});
