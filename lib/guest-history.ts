import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { Booking, Event, Prisma } from '@/generated/prisma/client';

export type Identity = { name?: string | null; email?: string | null; phone?: string | null };
export function normalizeIdentity(value: Identity) {
  const normalizedName = value.name?.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ') || null;
  const email = value.email?.trim().toLowerCase() || '';
  const normalizedEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/[*•]|guest\.(airbnb|booking)\.com|@relay\.|@privaterelay\.|@m\.agoda\./i.test(email) ? email : null;
  let phone = (value.phone || '').trim().replace(/[\s().-]/g, '');
  if (/^0082/.test(phone)) phone = '+' + phone.slice(2);
  if (/^010\d{8}$/.test(phone)) phone = '+82' + phone.slice(1);
  if (/^8210\d{8}$/.test(phone)) phone = '+' + phone;
  const normalizedPhone = /^\+[1-9]\d{7,14}$/.test(phone) && !/^\+(\d)\1+$/.test(phone) ? phone : null;
  return { normalizedName, normalizedEmail, normalizedPhone };
}
type Candidate = ReturnType<typeof normalizeIdentity> & { id: string };
export function decideGuest(identity: ReturnType<typeof normalizeIdentity>, candidates: Candidate[]) {
  const strong = candidates.filter(c => identity.normalizedName && c.normalizedName === identity.normalizedName &&
    ((identity.normalizedEmail && identity.normalizedEmail === c.normalizedEmail) || (identity.normalizedPhone && identity.normalizedPhone === c.normalizedPhone)) &&
    !(identity.normalizedEmail && c.normalizedEmail && identity.normalizedEmail !== c.normalizedEmail) &&
    !(identity.normalizedPhone && c.normalizedPhone && identity.normalizedPhone !== c.normalizedPhone));
  if (candidates.length === 1 && strong.length === 1) return { guestId: strong[0].id, matchStatus: 'matched', matchReason: 'contact-and-name' };
  return { guestId: null, matchStatus: 'review', matchReason: candidates.length ? 'ambiguous-identity' : 'insufficient-identity' };
}
export type ReservationInput = Identity & { key: string; propertyId: string; checkIn: string; checkOut: string; status: string; source: string };
export const reservationKey = (propertyId: string, ref: string) => `${propertyId}:beds24:${ref}`;
async function lock(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(73452187)) AS guest_lock`;
}
async function newGuest(tx: Prisma.TransactionClient, input: Identity & { source: string }) {
  return tx.guest.create({ data: { name: input.name, email: input.email, phone: input.phone, source: input.source, ...normalizeIdentity(input) } });
}
export async function saveGuestReservation(input: ReservationInput) {
  if (!input.checkIn || !input.checkOut) return;
  const identity = normalizeIdentity(input);
  const identitySignature = createHash('sha256').update(JSON.stringify([input.name || '', input.email || '', input.phone || ''])).digest('hex');
  return prisma.$transaction(async tx => {
    await lock(tx);
    const existing = await tx.guestReservation.findUnique({ where: { key: input.key } });
    // Stable manual decisions survive repeated imports; changed contact details require a fresh review.
    if (existing && existing.identitySignature === identitySignature && (existing.guestId || existing.matchStatus === 'ignored')) {
      return tx.guestReservation.update({ where: { id: existing.id }, data: input });
    }
    const OR = Object.entries(identity).filter(([, v]) => v).map(([k, v]) => ({ [k]: v }));
    const candidates = OR.length ? await tx.guest.findMany({ where: { OR }, take: 51 }) : [];
    let decision = decideGuest(identity, candidates);
    if (!candidates.length && identity.normalizedName && (identity.normalizedEmail || identity.normalizedPhone)) {
      const guest = await newGuest(tx, input);
      decision = { guestId: guest.id, matchStatus: 'new', matchReason: 'new-contact' };
    }
    const data = { ...input, ...decision, candidateIds: candidates.map(c => c.id), identitySignature, reviewedBy: null, reviewedAt: null };
    return tx.guestReservation.upsert({ where: { key: input.key }, create: data, update: data });
  }, { maxWait: 10000, timeout: 15000 });
}
export async function recordBooking(booking: Booking) {
  // Replace an earlier local-only key when Beds24 later assigns the canonical reference.
  const key = booking.channelBookingRef ? reservationKey(booking.propertyId, booking.channelBookingRef) : `booking:${booking.id}`;
  const previous = await prisma.guestReservation.findUnique({ where: { key } });
  const status = previous && ['cancelled', 'no_show'].includes(previous.status) && booking.status !== 'cancelled' ? previous.status : booking.status;
  await saveGuestReservation({ key, propertyId: booking.propertyId, name: booking.name, email: booking.email, phone: booking.phone,
    checkIn: booking.checkIn, checkOut: booking.checkOut, status, source: booking.source });
  if (booking.channelBookingRef) await prisma.guestReservation.deleteMany({ where: { key: `booking:${booking.id}` } });
}
export async function recordEvent(event: Event) {
  if (event.type !== 'reservation' || event.channelId !== 'beds24' || !event.originalUid) return;
  await saveGuestReservation({ key: reservationKey(event.propertyId, event.originalUid), propertyId: event.propertyId, name: event.title,
    email: event.guestEmail, phone: event.guestPhone, checkIn: event.startDate, checkOut: event.endDate, status: 'confirmed', source: event.source || 'beds24' });
}
export async function cancelGuestReservation(propertyId: string, ref: string) {
  await prisma.guestReservation.updateMany({ where: { key: reservationKey(propertyId, ref) }, data: { status: 'cancelled' } });
}
export async function reviewGuestReservation(id: string, guestId: string | null, reviewer: string, action: 'link' | 'new' | 'ignore') {
  return prisma.$transaction(async tx => {
    await lock(tx);
    const row = await tx.guestReservation.findUniqueOrThrow({ where: { id } });
    let selected = guestId;
    if (action === 'link') await tx.guest.findUniqueOrThrow({ where: { id: selected || '' } });
    if (action === 'new') selected = (await newGuest(tx, row)).id;
    if (action === 'ignore') selected = null;
    return tx.guestReservation.update({ where: { id }, data: { guestId: selected, matchStatus: action === 'ignore' ? 'ignored' : 'manual', matchReason: `admin-${action}`, reviewedBy: reviewer, reviewedAt: new Date() } });
  });
}
export function guestHistorySummary(rows: { key: string; status: string; checkIn: string; checkOut: string }[], currentKey?: string) {
  const valid = [...new Map(rows.filter(r => ['confirmed', 'completed'].includes(r.status) && r.key !== currentKey).map(r => [r.key, r])).values()];
  return { confirmedReservations: valid.length, completedStays: valid.filter(r => r.status === 'completed').length, isRebooking: valid.length > 0 };
}
// Customer indexing must not fail a payment or calendar sync. The admin reconciliation can retry it.
export async function indexGuestSafely(work: () => Promise<unknown>) {
  try { await work(); } catch { console.error('[guest-history] indexing pending; run guest reconciliation'); }
}
