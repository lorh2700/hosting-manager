import { prisma } from '@/lib/prisma';
import { withErrors, ok, fail, readJson } from '@/lib/core/http';
import { reconcileCheckout } from '@/lib/payments/checkout';
import { rateLimit, clientIp } from '@/lib/rateLimit';

export const maxDuration = 60;
export const POST = withErrors('checkout/paypal/webhook', async req => {
  if (!rateLimit(`paypal-webhook:${clientIp(req)}`, 120, 60_000).ok) throw fail(429, 'Retry later');
  const body = await readJson(req);
  const resource = body.resource as { id?: unknown; custom_id?: unknown; supplementary_data?: { related_ids?: { order_id?: unknown } } } | undefined;
  const providerId = resource?.supplementary_data?.related_ids?.order_id ?? (String(body.event_type).startsWith('CHECKOUT.ORDER.') ? resource?.id : undefined);
  const localId = resource?.custom_id;
  const valid = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(v);
  if (!valid(providerId) && !valid(localId)) return ok({ received: true });
  const order = await prisma.checkoutOrder.findFirst({ where: { gateway: 'paypal', OR: [
    ...(valid(providerId) ? [{ paymentKey: providerId }] : []), ...(valid(localId) ? [{ id: localId }] : []),
  ] } });
  // Untrusted wake-up only: never accept amount/status/capture IDs from this body.
  // The authenticated PayPal API is queried using the order identity stored locally.
  // APPROVED webhooks do not capture; only the authenticated customer return can do so.
  if (order) await reconcileCheckout(order.id);
  return ok({ received: true });
});
