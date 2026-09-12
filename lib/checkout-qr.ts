import { createHmac, timingSafeEqual } from 'node:crypto';

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
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const propertyId = Buffer.from(parts[0], 'base64url').toString('utf8');
  return propertyId && propertyId.length <= 128 ? propertyId : null;
}
