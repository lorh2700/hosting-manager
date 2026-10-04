import { withAuth, fail } from '@/lib/core/http';
import { prisma } from '@/lib/prisma';
import { todayKst, addDaysToDateStr } from '@/lib/dates';
import { canManageProperty } from '@/lib/access';
import { getPropertyDisplay, PROPERTY_DISPLAY } from '@/lib/property-display';
import { guestRequestDTO, privateStayResponse } from '@/lib/guest-stay-store';
import { guestStayDateSchema } from '@/lib/guest-stay';
export const GET = withAuth('guest-stays', async (req, { auth }) => {
  if (auth.role === 'cleaner') throw fail(403, '게스트 서비스 관리 권한이 없습니다.');
  const query = new URL(req.url).searchParams;
  const from = query.get('from') || addDaysToDateStr(todayKst(), -7), to = query.get('to') || addDaysToDateStr(todayKst(), 31);
  if (!guestStayDateSchema.safeParse(from).success || !guestStayDateSchema.safeParse(to).success || from > to || Date.parse(to) - Date.parse(from) > 120 * 86400000) throw fail(400, '조회 기간을 확인해 주세요.');
  const requested = query.get('propertyId');
  if (requested && !canManageProperty(auth, requested)) throw fail(403, '권한이 없습니다.');
  const properties = await prisma.property.findMany({ where: { ...(auth.isAdmin ? {} : { id: { in: auth.propertyIds || [] } }),
    ...(requested ? { id: requested } : {}), slug: { in: [...Object.keys(PROPERTY_DISPLAY), 'byeolha'] } }, select: { id: true, slug: true, name: true }, orderBy: { name: 'asc' } });
  const propertyIds = properties.map(p => p.id);
  const propertyMap = new Map(properties.map(p => [p.id, p]));
  const [events, bookings, accesses, requests, devices] = await Promise.all([
    prisma.event.findMany({ where: { propertyId: { in: propertyIds }, type: 'reservation', channelId: { in: ['beds24', 'direct'] },
      OR: [{ source: null }, { source: { not: 'maintenance' } }], startDate: { lte: to }, endDate: { gte: from } },
      select: { id: true, propertyId: true, title: true, startDate: true, endDate: true, numAdults: true, numChildren: true, originalUid: true }, orderBy: { startDate: 'asc' }, take: 101 }),
    prisma.booking.findMany({ where: { propertyId: { in: propertyIds }, status: 'confirmed', checkIn: { lte: to }, checkOut: { gte: from } },
      select: { id: true, propertyId: true, name: true, checkIn: true, checkOut: true, guests: true, channelBookingRef: true, checkout: { select: { beds24Id: true } } }, orderBy: { checkIn: 'asc' }, take: 101 }),
    prisma.guestStayAccess.findMany({ where: { propertyId: { in: propertyIds }, revokedAt: null, source: 'manual', expiresAt: { gt: new Date() } },
      select: { id: true, propertyId: true, reservationKind: true, reservationId: true, createdAt: true, expiresAt: true }, orderBy: { createdAt: 'desc' }, take: 300 }),
    prisma.guestStayRequest.findMany({ where: { propertyId: { in: propertyIds }, createdAt: { gte: new Date(`${from}T00:00:00+09:00`), lt: new Date(`${addDaysToDateStr(to, 1)}T00:00:00+09:00`) } }, orderBy: { createdAt: 'desc' }, take: 101 }),
    prisma.guestStayDevice.findMany({ where: { propertyId: { in: propertyIds } }, select: { id: true, propertyId: true, label: true, pairedAt: true,
      expiresAt: true, revokedAt: true, pairingExpiresAt: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  const imported = new Set(events.map(e => `${e.propertyId}:${e.originalUid}`).filter(key => !key.endsWith(':null')));
  const raw = [...events.filter(e => !!e.title?.trim() && !e.title.startsWith('[문의]')).map(e => ({ kind: 'event' as const, id: e.id, propertyId: e.propertyId,
    guestName: e.title!.replace(/\s+예약$/, '').trim(), checkIn: e.startDate, checkOut: e.endDate, guests: e.numAdults === null ? null : e.numAdults + (e.numChildren || 0) })),
    ...bookings.filter(b => !!b.name?.trim() && !imported.has(`${b.propertyId}:${b.channelBookingRef || b.checkout?.beds24Id || ''}`)).map(b => ({ kind: 'booking' as const, id: b.id,
      propertyId: b.propertyId, guestName: b.name!.trim(), checkIn: b.checkIn, checkOut: b.checkOut, guests: b.guests }))];
  const stays = raw.sort((a, b) => a.checkIn.localeCompare(b.checkIn)).slice(0, 100).map(stay => {
    const property = propertyMap.get(stay.propertyId)!;
    const access = accesses.find(a => a.reservationKind === stay.kind && a.reservationId === stay.id && a.propertyId === stay.propertyId);
    return { ...stay, propertyName: getPropertyDisplay(property.slug || '')?.name || property.name,
      slug: getPropertyDisplay(property.slug || '')?.slug || property.slug,
      access: access ? { id: access.id, issuedAt: access.createdAt.toISOString(), expiresAt: access.expiresAt.toISOString() } : null };
  });
  return privateStayResponse({ properties: properties.map(p => ({ ...p, slug: getPropertyDisplay(p.slug || '')?.slug || p.slug })), stays,
    requests: requests.slice(0, 100).map(row => ({ ...guestRequestDTO(row), propertyId: row.propertyId, propertyName: propertyMap.get(row.propertyId)?.name || '',
      guestName: row.guestName, reservationKind: row.reservationKind, reservationId: row.reservationId, internalNote: row.internalNote })),
    devices: devices.map(d => ({ ...d, pairedAt: d.pairedAt?.toISOString() || null, expiresAt: d.expiresAt.toISOString(), revokedAt: d.revokedAt?.toISOString() || null,
      pairingExpiresAt: d.pairingExpiresAt.toISOString(), createdAt: d.createdAt.toISOString() })), nextCursor: null,
    truncated: raw.length > 100 || requests.length > 100 || events.length > 100 || bookings.length > 100 });
});
