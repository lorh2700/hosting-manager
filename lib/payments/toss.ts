import { paymentKeys } from './config';
import { majorAmount, type PaymentResult } from './money';

export class TossError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) { super(`Payment provider: ${code}`); this.code = code; this.status = status; }
}

export async function tossRequest(order: { gateway: string; mode: string }, path: string, body?: object, idempotencyKey?: string): Promise<PaymentResult> {
  const { secretKey } = paymentKeys(order.gateway, order.mode);
  const res = await fetch(`https://api.tosspayments.com/v1/payments${path}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new TossError(String(data.code ?? 'UNKNOWN'), res.status);
  return data;
}

export const getPayment = (order: { id: string; gateway: string; mode: string }) => tossRequest(order, `/orders/${encodeURIComponent(order.id)}`);
export const confirmPayment = (order: { id: string; gateway: string; mode: string; currency: string; amountMinor: number }, paymentKey: string) =>
  tossRequest(order, '/confirm', { orderId: order.id, paymentKey, amount: majorAmount(order) }, `${order.id}-confirm`);
export const refundPayment = (order: { id: string; gateway: string; mode: string; paymentKey: string | null; currency: string }) => {
  if (!order.paymentKey) throw new Error('Payment key missing');
  return tossRequest(order, `/${encodeURIComponent(order.paymentKey)}/cancel`, { cancelReason: '예약 취소 / Booking cancellation', currency: order.currency }, `${order.id}-refund`);
};
