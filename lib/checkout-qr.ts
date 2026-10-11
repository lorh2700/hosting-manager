import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Exact token digests from verified printed cards; never retain an old signing key.
const printedQrRecoveries: Readonly<Record<string, string>> = {
  '8bc3e80d7dc7b35138bd381d59467cc150497fff9605f47638405af21027bd8d': 'c830c242-d1d5-4af1-9f68-43e2f5ae486a',
};

function signature(encoded: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('QR signing key is not configured');
  return createHmac('sha256', secret).update(`void-guest-checkout-v1:${encoded}`).digest('base64url');
}

// A property-scoped capability, separate from session and pad API credentials.
// Fixed QR codes remain valid across stays; the server always resolves today's departure.
export function checkoutQrToken(propertyId: string): string {
  const encoded = Buffer.from(propertyId).toString('base64url');
  return `${encoded}.${signature(encoded)}`;
}
export function verifyCheckoutQr(token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 512) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const expected = Buffer.from(signature(parts[0]));
  const actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    const digest = createHash('sha256').update(token).digest('hex');
    return printedQrRecoveries[digest] ?? null;
  }
  const propertyId = Buffer.from(parts[0], 'base64url').toString('utf8');
  return propertyId && propertyId.length <= 128 ? propertyId : null;
}
