import { todayKst } from '@/lib/dates';
import { normalizeIdentity } from '@/lib/guest-history';
import type { Prisma } from '@/generated/prisma/client';

export function guestSearchWhere(q: string): Prisma.GuestWhereInput {
  if (!q) return {};
  const name = normalizeIdentity({ name: q }).normalizedName;
  const digits = q.replace(/\D/g, '');
  const phone = /^010/.test(digits) ? '+82' + digits.slice(1) : digits;
  return { OR: [
    { name: { contains: q, mode: 'insensitive' } }, { normalizedName: { contains: name || q } },
    { email: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } },
    ...(digits.length >= 3 ? [{ normalizedPhone: { contains: phone } }] : []),
  ] };
}
export function summarizeReservations(rows: { status: string; checkIn: string; checkOut: string; propertyId: string }[], today = todayKst()) {
  const confirmed = rows.filter(r => ['confirmed', 'completed'].includes(r.status));
  const past = confirmed.filter(r => r.checkOut < today);
  return { bookingCount: confirmed.length, pastReservations: past.length, completedStays: confirmed.filter(r => r.status === 'completed').length,
    lastReservationDate: past.map(r => r.checkOut).sort().at(-1) || null, propertyIds: [...new Set(confirmed.map(r => r.propertyId))] };
}
