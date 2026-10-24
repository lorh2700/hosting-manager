import { prisma } from '@/lib/prisma';
import { createGuestLinkStore } from './guest-link-store';
import { openInvitation } from './guest-invitation-token';
import { recoverInvitation } from './guest-invitation-recovery';
import { invitationReservation, invitationPastStay } from './guest-invitation-reservation';

export async function resolveInvitation(token: string, now = Date.now()) {
  const store = createGuestLinkStore(prisma);
  const stored = await store.invitation(token, now);
  if (stored.found) return stored.reference;
  const reference = openInvitation(token, process.env.JWT_SECRET || '', now) || recoverInvitation(token, now);
  if (!reference) return null;
  const reservation = await invitationReservation(reference.kind, reference.id);
  if (!reservation || reservation.propertyId !== reference.propertyId || invitationPastStay(reservation.checkOut)) return null;
  return await store.registerInvitation(token, reference) ? reference : null;
}
