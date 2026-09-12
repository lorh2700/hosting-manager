import { createHash } from 'node:crypto';
import type { CheckoutOrder } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { paymentKeys } from './config';
import { toMinor, type PaymentResult } from './money';

type Amount = { currency_code: string; value: string };
type Capture = { id: string; status: string; amount: Amount };
type PaypalOrder = { id: string; intent: string; status: string; links?: { rel: string; href: string }[];
  purchase_units: { custom_id?: string; invoice_id?: string; amount: Amount; payments?: { captures?: Capture[] } }[] };
type Refund = { id: string; status: string; amount: Amount; links?: { rel: string; href: string }[] };

export class PayPalError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 0) { super(`PayPal: ${code}`); this.code = code; this.status = status; }
}
const requestId = (id: string, action: string) => createHash('sha256').update(`${id}:${action}`).digest('hex').slice(0, 36);
const base = (mode: string) => mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

async function paypalRequest<T>(o: Pick<CheckoutOrder, 'mode'>, path: string, body?: object, key?: string): Promise<T> {
  const { clientKey, secretKey } = paymentKeys('paypal', o.mode);
  const auth = await fetch(`${base(o.mode)}/v1/oauth2/token`, {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Basic ${Buffer.from(`${clientKey}:${secretKey}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!auth.ok) throw new PayPalError('AUTHENTICATION_FAILED', auth.status);
  const token = await auth.json();
  if (typeof token.access_token !== 'string' || !token.access_token) throw new PayPalError('INVALID_AUTH_RESPONSE');
  const res = await fetch(`${base(o.mode)}${path}`, {
    method: body ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(key ? { 'PayPal-Request-Id': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new PayPalError('REQUEST_FAILED', res.status);
  return res.json();
}

function assertAmount(o: CheckoutOrder, amount: Amount) {
  if (amount?.currency_code !== o.currency || toMinor(amount?.value, o.currency) !== o.amountMinor) throw new PayPalError('AMOUNT_MISMATCH');
}
function assertOrder(o: CheckoutOrder, remote: PaypalOrder) {
  if (!remote.id || (o.paymentKey && remote.id !== o.paymentKey) || remote.intent !== 'CAPTURE' || remote.purchase_units?.length !== 1) throw new PayPalError('ORDER_MISMATCH');
  const unit = remote.purchase_units[0];
  if (unit.custom_id !== o.id || unit.invoice_id !== o.id) throw new PayPalError('ORDER_MISMATCH');
  assertAmount(o, unit.amount);
  return unit;
}
export function approvalUrl(remote: PaypalOrder, mode: string) {
  const raw = remote.links?.find(l => ['payer-action', 'approve'].includes(l.rel))?.href;
  if (!raw) throw new PayPalError('APPROVAL_LINK_MISSING');
  const url = new URL(raw);
  const hosts = mode === 'live' ? ['www.paypal.com', 'paypal.com'] : ['www.sandbox.paypal.com', 'sandbox.paypal.com'];
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || url.port) throw new PayPalError('INVALID_APPROVAL_LINK');
  return url.href;
}

export async function startPayPal(o: CheckoutOrder, origin: string) {
  if (o.currency !== 'USD') throw new PayPalError('UNSUPPORTED_CURRENCY');
  let remote: PaypalOrder;
  if (o.paymentKey) remote = await paypalRequest<PaypalOrder>(o, `/v2/checkout/orders/${encodeURIComponent(o.paymentKey)}`);
  else remote = await paypalRequest<PaypalOrder>(o, '/v2/checkout/orders', {
    intent: 'CAPTURE', purchase_units: [{ custom_id: o.id, invoice_id: o.id,
      description: `${o.propertyName} ${o.checkIn} - ${o.checkOut}`.slice(0, 127),
      amount: { currency_code: o.currency, value: (o.amountMinor / 100).toFixed(2) } }],
    payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
      return_url: `${origin}/book/checkout/${o.id}?result=success`, cancel_url: `${origin}/book/checkout/${o.id}?result=fail` } } },
  }, requestId(o.id, 'create'));
  assertOrder(o, remote);
  // Persist the provider identity before returning any approval link to a browser.
  await prisma.checkoutOrder.update({ where: { id: o.id }, data: { paymentKey: remote.id } });
  if (['APPROVED', 'COMPLETED'].includes(remote.status)) return { resumeConfirmation: true };
  return { approvalUrl: approvalUrl(remote, o.mode) };
}

async function inspect(o: CheckoutOrder) {
  if (!o.paymentKey) throw new PayPalError('NOT_STARTED');
  const remote = await paypalRequest<PaypalOrder>(o, `/v2/checkout/orders/${encodeURIComponent(o.paymentKey)}`);
  const unit = assertOrder(o, remote);
  const captures = unit.payments?.captures ?? [];
  if (captures.length > 1) throw new PayPalError('MULTIPLE_CAPTURES');
  let capture: Capture | undefined;
  if (captures.length) {
    capture = await paypalRequest<Capture>(o, `/v2/payments/captures/${encodeURIComponent(captures[0].id)}`);
    if (capture.id !== captures[0].id) throw new PayPalError('CAPTURE_MISMATCH');
    assertAmount(o, capture.amount);
  }
  const status = capture ? ({ COMPLETED: 'DONE', REFUNDED: 'CANCELED', PARTIALLY_REFUNDED: 'PARTIAL_CANCELED', PENDING: 'PENDING', DECLINED: 'ABORTED', FAILED: 'ABORTED' }[capture.status] ?? 'PENDING')
    : ({ CREATED: 'READY', SAVED: 'READY', PAYER_ACTION_REQUIRED: 'READY', APPROVED: 'IN_PROGRESS', VOIDED: 'EXPIRED' }[remote.status] ?? 'PENDING');
  const payment: PaymentResult = { orderId: o.id, paymentKey: remote.id, currency: o.currency, totalAmount: o.amountMinor / 100, status };
  return { payment, capture };
}
export const getPayPalPayment = async (o: CheckoutOrder) => (await inspect(o)).payment;

export async function capturePayPal(o: CheckoutOrder) {
  // Re-read before capture; a lost response may already have completed the payment.
  const current = await inspect(o);
  if (current.payment.status !== 'IN_PROGRESS') return current.payment;
  // PayPal's default idempotency retention is 6 hours. Never blindly retry beyond it.
  if (!o.termsAcceptedAt || Date.now() - o.termsAcceptedAt.getTime() > 5 * 60 * 60_000) throw new PayPalError('CAPTURE_REQUIRES_REVIEW');
  await paypalRequest(o, `/v2/checkout/orders/${encodeURIComponent(o.paymentKey!)}/capture`, {}, requestId(o.id, 'capture'));
  return getPayPalPayment(o);
}

export async function refundPayPal(o: CheckoutOrder) {
  const current = await inspect(o);
  if (current.payment.status === 'CANCELED') return current.payment;
  if (!current.capture || current.payment.status !== 'DONE') throw new PayPalError('CAPTURE_NOT_REFUNDABLE');
  let refund: Refund;
  if (o.paypalRefundId) {
    refund = await paypalRequest<Refund>(o, `/v2/payments/refunds/${encodeURIComponent(o.paypalRefundId)}`);
    if (refund.id !== o.paypalRefundId) throw new PayPalError('REFUND_MISMATCH');
  } else {
    if (o.paypalRefundRequestedAt && Date.now() - o.paypalRefundRequestedAt.getTime() > 5 * 60 * 60_000) throw new PayPalError('REFUND_REQUIRES_REVIEW');
    if (!o.paypalRefundRequestedAt) await prisma.checkoutOrder.update({ where: { id: o.id }, data: { paypalRefundRequestedAt: new Date() } });
    refund = await paypalRequest<Refund>(o, `/v2/payments/captures/${encodeURIComponent(current.capture.id)}/refund`, {
      amount: { currency_code: o.currency, value: (o.amountMinor / 100).toFixed(2) },
    }, requestId(o.id, 'refund'));
    if (!refund.id) throw new PayPalError('REFUND_ID_MISSING');
    await prisma.checkoutOrder.update({ where: { id: o.id }, data: { paypalRefundId: refund.id } });
  }
  assertAmount(o, refund.amount);
  if (['FAILED', 'CANCELLED'].includes(refund.status)) throw new PayPalError('REFUND_REQUIRES_REVIEW');
  // PENDING refunds must keep the room blocked. Verify full refund on the capture itself.
  return getPayPalPayment(o);
}
