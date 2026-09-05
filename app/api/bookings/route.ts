import { prisma } from '@/lib/prisma';
import {
  withAuth, ok, created, fail, MESSAGES,
  requireManage, visibleScope, readJson, dateStr, str, int, idList, query, requireQuery,
} from '@/lib/core/http';

const STATUSES = ['pending', 'confirmed', 'cancelled'];

// body 를 그대로 Prisma 에 넘기지 않는다 — 허용 필드만 골라 담는다.
// (예: 화면이 보내는 cancelledAt 은 Booking 컬럼이 아니라 이전에는 500 을 냈다.)
function pickBookingFields(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  const name = str(body, 'name', { max: 100 }); if (name !== undefined) data.name = name.trim();
  const email = str(body, 'email', { max: 200 }); if (email !== undefined) data.email = email.trim();
  const phone = str(body, 'phone', { max: 40 }); if (phone !== undefined) data.phone = phone.trim();
  const guests = int(body, 'guests', { min: 1, max: 50 }); if (guests !== undefined) data.guests = guests;
  const checkIn = dateStr(body, 'checkIn'); if (checkIn) data.checkIn = checkIn;
  const checkOut = dateStr(body, 'checkOut'); if (checkOut) data.checkOut = checkOut;
  if (typeof body.status === 'string' && STATUSES.includes(body.status)) data.status = body.status;
  const message = str(body, 'message', { max: 2000 }); if (message !== undefined) data.message = message;
  const source = str(body, 'source', { max: 50 }); if (source !== undefined) data.source = source;
  if (typeof body.channelBookingRef === 'string' || body.channelBookingRef === null) {
    data.channelBookingRef = body.channelBookingRef ? String(body.channelBookingRef).slice(0, 100) : null;
  }
  return data;
}

export const GET = withAuth('bookings', async (req, { auth }) => {
  const where: Record<string, unknown> = {};
  const visible = await visibleScope(auth, idList(req, 'propertyIds'));
  if (visible !== null) {
    if (visible.length === 0) return ok([]);
    where.propertyId = { in: visible };
  }
  const status = query(req, 'status');
  if (status) where.status = status;

  const limit = Math.min(Number(query(req, 'limit')) || 500, 1000);
  const offset = Number(query(req, 'offset')) || 0;

  return ok(await prisma.booking.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }));
});

export const POST = withAuth('bookings', async (req, { auth }) => {
  const body = await readJson(req);
  const propertyId = str(body, 'propertyId', { required: true })!;
  const data = pickBookingFields(body);
  if (typeof data.checkIn !== 'string' || typeof data.checkOut !== 'string') {
    throw fail(400, 'propertyId, checkIn, checkOut은 필수입니다.');
  }
  if (data.checkIn >= data.checkOut) throw fail(400, '체크아웃은 체크인보다 뒤여야 합니다.');
  requireManage(auth, propertyId);

  const booking = await prisma.booking.create({
    data: {
      propertyId,
      name: (data.name as string | undefined) ?? null,
      email: (data.email as string | undefined) ?? null,
      phone: (data.phone as string | undefined) ?? null,
      guests: (data.guests as number | undefined) ?? 1,
      checkIn: data.checkIn,
      checkOut: data.checkOut,
      status: (data.status as string | undefined) ?? 'pending',
      message: (data.message as string | undefined) ?? null,
      source: (data.source as string | undefined) ?? 'direct',
      channelBookingRef: (data.channelBookingRef as string | null | undefined) ?? null,
    },
  });
  return created(booking);
});

export const PUT = withAuth('bookings', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;

  const existing = await prisma.booking.findUnique({ where: { id }, select: { propertyId: true, checkIn: true, checkOut: true } });
  if (!existing) throw fail(404, MESSAGES.notFound);
  requireManage(auth, existing.propertyId);

  const data = pickBookingFields(body);
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);
  const nextIn = (data.checkIn as string | undefined) ?? existing.checkIn;
  const nextOut = (data.checkOut as string | undefined) ?? existing.checkOut;
  if (nextIn >= nextOut) throw fail(400, '체크아웃은 체크인보다 뒤여야 합니다.');

  return ok(await prisma.booking.update({ where: { id }, data }));
});

export const DELETE = withAuth('bookings', async (req, { auth }) => {
  const id = requireQuery(req, 'id');
  const existing = await prisma.booking.findUnique({ where: { id }, select: { propertyId: true } });
  if (!existing) throw fail(404, MESSAGES.notFound);
  requireManage(auth, existing.propertyId);

  await prisma.booking.delete({ where: { id } });
  return ok({ success: true });
});
