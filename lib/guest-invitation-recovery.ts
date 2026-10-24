import { createHash } from 'node:crypto';
import type { GuestInvitationReference } from './guest-invitation-token';

// Exact-match recovery for legacy links verified against their live reservations.
// Store only its digest, never the bearer URL. Do not accept partial/prefix matches.
const recoveries: Readonly<Record<string, GuestInvitationReference>> = {
  '194c6e6467223a72b2f6c826891058f31165ab2f2d564a6bad9bf801ebd15650': {
    kind: 'event',
    id: '86ab620a-3508-4855-adf1-4205ebb62eda',
    propertyId: 'Z4jFeng2zG9WpAhWtow3',
    expires: 1795359600000,
  },
  db74a611ba40c6925c46cf031109e0fdd89bd86762b615b838f24926c066087d: {
    kind: 'event',
    id: 'a7fe2b31-dec8-4b50-b260-d310fa9f78af',
    propertyId: 'c830c242-d1d5-4af1-9f68-43e2f5ae486a',
    expires: 1795618800000,
  },
  // Beds24 booking 93904363: link issued before JWT_SECRET rotation.
  '4d87a56434acf93ca5aa66dc6dc9f8071cf987e9de3a2c07cffb708af9454cad': {
    kind: 'event',
    id: 'cb9ac339-4c8d-410e-a828-416a3d260c25',
    propertyId: 'oKWKVQqLy7uENyHUwljr',
    expires: 1794754800000,
  },
  ef1507a1f0350c6915a593480b15cff686d7f99138b57301010b55799c5c4c8a: {
    kind: 'event',
    id: '0fd99664-5507-4c6e-ab09-5d9ee8eafc42',
    propertyId: 'c830c242-d1d5-4af1-9f68-43e2f5ae486a',
    expires: 1800716400000,
  },
};

export function recoverInvitation(token: string, now = Date.now()): GuestInvitationReference | null {
  if (!/^[A-Za-z0-9_-]{60,1024}$/.test(token)) return null;
  const digest = createHash('sha256').update(token).digest('hex');
  const ref = recoveries[digest];
  return ref && ref.expires > now ? { ...ref } : null;
}
