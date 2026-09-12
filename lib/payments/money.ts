export type Gateway = 'card' | 'paypal';

export function toMinor(value: unknown, currency: string): number {
  const text = String(value);
  const pattern = currency === 'KRW' ? /^\d+$/ : /^\d+(\.\d{1,2})?$/;
  if (!['KRW', 'USD'].includes(currency) || !pattern.test(text)) throw new Error('Invalid payment amount');
  const parts = text.split('.');
  const minor = currency === 'KRW' ? Number(text) : Number(parts[0]) * 100 + Number((parts[1] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > 2_000_000_000) throw new Error('Invalid payment amount');
  return minor;
}

export function chargeAmount(krw: number, gateway: Gateway, rate?: string) {
  toMinor(krw, 'KRW');
  if (gateway === 'card') return { currency: 'KRW', amountMinor: krw, fxRate: null };
  // Rate is KRW per USD, configured by the merchant, fixed into the quote.
  if (!rate || !/^\d+(\.\d{1,4})?$/.test(rate) || Number(rate) <= 0) throw new Error('PayPal exchange rate is not configured');
  const amountMinor = Math.round(krw / Number(rate) * 100);
  toMinor((amountMinor / 100).toFixed(2), 'USD');
  return { currency: 'USD', amountMinor, fxRate: rate };
}

export function majorAmount(order: { currency: string; amountMinor: number }) {
  return order.currency === 'USD' ? order.amountMinor / 100 : order.amountMinor;
}

export interface PaymentResult {
  orderId: string; paymentKey: string; currency: string; totalAmount: number;
  status: string; balanceAmount?: number;
}

export function assertPayment(order: { id: string; currency: string; amountMinor: number; paymentKey?: string | null }, payment: PaymentResult) {
  if (payment.orderId !== order.id || payment.currency !== order.currency ||
      toMinor(payment.totalAmount, payment.currency) !== order.amountMinor ||
      !payment.paymentKey || (order.paymentKey && order.paymentKey !== payment.paymentKey)) {
    throw new Error('Payment identity or amount mismatch');
  }
}
