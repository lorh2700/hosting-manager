import type { Gateway } from './money';

export function paymentKeys(gateway: string, mode: string) {
  if (!['test', 'live'].includes(mode) || mode !== process.env.CHECKOUT_MODE) throw new Error('Payment mode mismatch');
  if (gateway === 'paypal') {
    const expected = mode === 'live' ? 'live' : 'sandbox';
    if (process.env.PAYPAL_ENV !== expected) throw new Error('PayPal environment mismatch');
    const clientKey = process.env.PAYPAL_CLIENT_ID?.trim();
    const secretKey = process.env.PAYPAL_CLIENT_SECRET?.trim();
    if (!clientKey || !secretKey) throw new Error('PayPal credentials are not configured');
    return { clientKey, secretKey };
  }
  if (gateway !== 'card') throw new Error('Unknown payment gateway');
  const prefix = 'TOSS';
  const clientKey = process.env[`${prefix}_CLIENT_KEY`];
  const secretKey = process.env[`${prefix}_SECRET_KEY`];
  if (!clientKey?.startsWith(`${mode}_ck_`) || !secretKey?.startsWith(`${mode}_sk_`)) throw new Error('Payment API keys are not configured');
  return { clientKey, secretKey };
}

export function checkoutConfig(propertyId: string, gateway: Gateway) {
  if (process.env.CHECKOUT_ENABLED !== 'true' || !process.env.CHECKOUT_PROPERTY_IDS?.split(',').map(s => s.trim()).includes(propertyId)) throw new Error('Online payment is not available for this property yet.');
  const mode = process.env.CHECKOUT_MODE ?? 'test';
  if (!process.env.CRON_SECRET || process.env.CHECKOUT_PRICE_INCLUDES_ALL_FEES !== 'true') throw new Error('Checkout reconciliation or all-inclusive pricing is not configured');
  paymentKeys(gateway, mode);
  const offerId = Number(process.env.CHECKOUT_BEDS24_OFFER_ID);
  if (!Number.isSafeInteger(offerId) || offerId < 1) throw new Error('Booking offer is not configured');
  const terms = process.env.CHECKOUT_TERMS;
  if (!terms?.trim()) throw new Error('Cancellation terms are not configured');
  const origin = new URL(process.env.CHECKOUT_SITE_URL ?? '');
  if (origin.protocol !== 'https:' && !(mode === 'test' && origin.hostname === 'localhost')) throw new Error('Invalid checkout URL');
  return { mode, offerId, terms, origin: origin.origin };
}
