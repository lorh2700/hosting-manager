import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { createGuestLinkStore } from '@/lib/guest-link-store';

// Exact token digests from verified printed cards; never retain an old signing key.
const printedQrRecoveries: Readonly<Record<string, string>> = {
  'cddfc9c92ba57c7e793ba663edc60970bc5a202bbcca951ac0a79fe72873eaff': '70X0HKDJasPU3RQj67aU',
  '99516806ab90e570b2fbe30c6aa50c13d262adfc189b1f7ccf1f21f73f9bb742': 'oKWKVQqLy7uENyHUwljr',
  '70f4987938c580bff108acf2508563a9c7b1a4c6a892309a68617c6a5d4f6cda': 'Z4jFeng2zG9WpAhWtow3',
  '8bc3e80d7dc7b35138bd381d59467cc150497fff9605f47638405af21027bd8d': 'c830c242-d1d5-4af1-9f68-43e2f5ae486a',
  'e6eac7ecdc6c5481df6aaf5684efe25acef047819580b16efedd9d7385ee0053': '5plQsEOe9sTHzSsMS0pc',
};

export async function checkoutQrToken(propertyId: string): Promise<string> {
  return createGuestLinkStore(prisma).issueCheckout(propertyId);
}

export async function verifyCheckoutQr(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_.-]{1,512}$/.test(token)) return null;
  const store = createGuestLinkStore(prisma);
  const registered = await store.checkout(token);
  if (registered.found) return registered.propertyId;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const propertyId = Buffer.from(parts[0], 'base64url').toString('utf8');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(propertyId) || Buffer.from(propertyId).toString('base64url') !== parts[0]) return null;
  const digest = createHash('sha256').update(token).digest('hex');
  let verified = printedQrRecoveries[digest] === propertyId;
  const secret = process.env.JWT_SECRET;
  if (!verified && secret) {
    const expected = Buffer.from(createHmac('sha256', secret).update(`void-guest-checkout-v1:${parts[0]}`).digest('base64url'));
    const actual = Buffer.from(parts[1]);
    verified = expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  if (!verified) return null;
  return await store.registerCheckout(token, propertyId) ? propertyId : null;
}
