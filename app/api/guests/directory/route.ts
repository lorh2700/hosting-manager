import { guestRegion } from '@/lib/guest-region';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, query } from '@/lib/core/http';
import { todayKst } from '@/lib/dates';
import { guestSearchWhere, summarizeReservations } from '@/lib/guest-directory';
import type { Prisma } from '@/generated/prisma/client';

export const GET = withAuth('guests/directory', async req => {
  const id = query(req, 'id');
  if (id) {
    const guest = await prisma.guest.findUnique({ where: { id }, select: { id: true, name: true, email: true, phone: true, notes: true, source: true } });
    if (!guest) throw fail(404, '고객을 찾을 수 없습니다.');
    const page = Math.max(1, Math.min(100000, Math.floor(Number(query(req, 'page')) || 1)));
    const [rows, total, properties] = await Promise.all([
      prisma.guestReservation.findMany({ where: { guestId: id }, orderBy: [{ checkIn: 'desc' }, { id: 'asc' }], skip: (page - 1) * 20, take: 20,
        select: { id: true, propertyId: true, checkIn: true, checkOut: true, status: true, source: true, matchStatus: true } }),
      prisma.guestReservation.count({ where: { guestId: id } }), prisma.property.findMany({ select: { id: true, name: true } }),
    ]);
    const countryHistory = await prisma.guestReservation.findMany({ where: { guestId: id, residenceCountry: { not: null } }, select: { checkIn: true, residenceCountry: true } });
    const response = ok({ guest: { ...guest, region: guestRegion(guest.phone, countryHistory) }, rows, total, page, pageSize: 20, properties });
    response.headers.set('Cache-Control', 'private, no-store'); return response;
  }
  const q = (query(req, 'q') || '').trim().slice(0, 200);
  const filter = query(req, 'filter') || 'past';
  if (!['past', 'all', 'completed'].includes(filter)) throw fail(400, '조회 조건을 확인해주세요.');
  const page = Math.max(1, Math.min(100000, Math.floor(Number(query(req, 'page')) || 1)));
  const where: Prisma.GuestWhereInput = { ...guestSearchWhere(q), ...(filter === 'all' ? {} : { reservations: { some: filter === 'completed' ? { status: 'completed' } : { status: { in: ['confirmed', 'completed'] }, checkOut: { lt: todayKst() } } } }) };
  const [guests, total, properties, reviewCount] = await Promise.all([
    prisma.guest.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 25, skip: (page - 1) * 25,
      select: { id: true, name: true, email: true, phone: true, source: true } }),
    prisma.guest.count({ where }), prisma.property.findMany({ select: { id: true, name: true } }),
    prisma.guestReservation.count({ where: { matchStatus: 'review' } }),
  ]);
  const history = await prisma.guestReservation.findMany({ where: { guestId: { in: guests.map(g => g.id) } }, select: { residenceCountry: true, guestId: true, status: true, checkIn: true, checkOut: true, propertyId: true } });
  const response = ok({ rows: guests.map(g => ({ ...g, region: guestRegion(g.phone, history.filter(h => h.guestId === g.id)), ...summarizeReservations(history.filter(h => h.guestId === g.id)) })), total, page, pageSize: 25, properties, reviewCount });
  response.headers.set('Cache-Control', 'private, no-store'); return response;
}, { admin: true });
