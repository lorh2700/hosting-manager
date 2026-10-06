import { createHash } from 'node:crypto';
import type { GuestInvitationReference } from './guest-invitation-token';

// Exact-match recovery for legacy links verified against their live reservations.
// Store only its digest, never the bearer URL. Do not accept partial/prefix matches.
const recoveries: Readonly<Record<string, GuestInvitationReference>> = {
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
};

export function recoverInvitation(token: string, now = Date.now()): GuestInvitationReference | null {
  if (!/^[A-Za-z0-9_-]{60,1024}$/.test(token)) return null;
  const digest = createHash('sha256').update(token).digest('hex');
  const ref = recoveries[digest];
  return ref && ref.expires > now ? { ...ref } : null;
}
