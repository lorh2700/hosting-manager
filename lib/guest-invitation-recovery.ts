import { createHash } from 'node:crypto';
import type { GuestInvitationReference } from './guest-invitation-token';

// Exact-match recovery for a damaged link verified against Beds24 booking 93464966.
// Store only its digest, never the bearer URL. Do not accept partial/prefix matches.
const recoveries: Readonly<Record<string, GuestInvitationReference>> = {
  db74a611ba40c6925c46cf031109e0fdd89bd86762b615b838f24926c066087d: {
    kind: 'event',
    id: 'a7fe2b31-dec8-4b50-b260-d310fa9f78af',
    propertyId: 'c830c242-d1d5-4af1-9f68-43e2f5ae486a',
    expires: 1795618800000,
  },
};

export function recoverInvitation(token: string, now = Date.now()): GuestInvitationReference | null {
  if (!/^[A-Za-z0-9_-]{60,1024}$/.test(token)) return null;
  const digest = createHash('sha256').update(token).digest('hex');
  const ref = recoveries[digest];
  return ref && ref.expires > now ? { ...ref } : null;
}
