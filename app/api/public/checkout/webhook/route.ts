import { withErrors, ok, fail, readJson } from '@/lib/core/http';
import { prisma } from '@/lib/prisma';
import { reconcileCheckout } from '@/lib/payments/checkout';
import { rateLimit, clientIp } from '@/lib/rateLimit';

export const maxDuration = 60;
export const POST = withErrors('checkout/webhook', async req => {
  if (!rateLimit(`payment-webhook:${clientIp(req)}`, 120, 60_000).ok) throw fail(429, 'Retry later');
  const body = await readJson(req);
  const data = body.data as { orderId?: unknown } | undefined;
  if (typeof data?.orderId !== 'string' || data.orderId.length > 64) return ok({ received: true });
  const order = await prisma.checkoutOrder.findUnique({ where: { id: data.orderId } });
  if (order) {
    // A webhook is an untrusted wake-up signal. All values/statuses are read back from Toss.
    // It must never approve a payment or trust the event's amount/status/paymentKey.
    await reconcileCheckout(order.id);
  }
  return ok({ received: true });
});
