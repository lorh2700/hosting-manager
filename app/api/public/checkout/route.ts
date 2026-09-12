import { withErrors, ok, fail, readJson } from '@/lib/core/http';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { authorizedOrder, publicOrder, quoteCheckout, reconcileCheckout, startCheckout, priceStay } from '@/lib/payments/checkout';

export const maxDuration = 60;
export const POST = withErrors('public/checkout', async req => {
  const body = await readJson(req);
  const limit = body.action === 'quote' ? 6 : body.action === 'status' ? 90 : 30;
  if (!rateLimit(`checkout:${body.action}:${clientIp(req)}`, limit, 10 * 60_000).ok) throw fail(429, '잠시 후 다시 시도해주세요. / Please try again later.');
  if (body.action === 'price') {
    const price = await priceStay(body);
    return ok({ priceKrw: price.priceKrw, currency: price.currency, nights: price.nights, includesAllFees: price.includesAllFees });
  }
  if (body.action === 'quote') return ok(await quoteCheckout(body));
  const order = await authorizedOrder(String(body.orderId ?? ''), req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '');
  if (body.action === 'status') return ok(publicOrder(order));
  if (body.action === 'start') {
    if (body.acceptTerms !== true) throw fail(400, '취소·환불 규정에 동의해주세요.');
    return ok(await startCheckout(order));
  }
  if (body.action === 'confirm') {
    try { return ok(publicOrder(await reconcileCheckout(order.id, true))); }
    catch { return ok({ ...publicOrder(await authorizedOrder(order.id, req.headers.get('authorization')!.slice(7))), processing: true }); }
  }
  throw fail(400, 'Unknown checkout action');
});
