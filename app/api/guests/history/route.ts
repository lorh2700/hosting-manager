import { prisma } from '@/lib/prisma';
import { withAuth, ok, readJson, str, fail, query } from '@/lib/core/http';
import { guestHistorySummary, normalizeIdentity, recordBooking, recordEvent, reviewGuestReservation } from '@/lib/guest-history';

export const GET = withAuth('guest-history', async req => {
  const offset = Math.max(0, Math.floor(Number(query(req, 'offset')) || 0));
  const rows = await prisma.guestReservation.findMany({ orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 50, skip: offset });
  const guestIds = [...new Set(rows.flatMap(r => [...r.candidateIds, ...(r.guestId ? [r.guestId] : [])]))];
  const guests = await prisma.guest.findMany({ where: { id: { in: guestIds } }, select: { id: true, name: true, email: true, phone: true } });
  const history = await prisma.guestReservation.findMany({ where: { guestId: { in: guestIds } }, select: { guestId: true, key: true, status: true, checkIn: true, checkOut: true, propertyId: true } });
  const properties = await prisma.property.findMany({ select: { id: true, name: true } });
  const response = ok({ rows: rows.map(r => ({ ...r, summary: r.guestId ? guestHistorySummary(history.filter(h => h.guestId === r.guestId), r.key) : null })), guests, properties, hasMore: rows.length === 50 });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}, { admin: true });

export const PUT = withAuth('guest-history/review', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;
  const action = str(body, 'action', { required: true });
  if (!['link', 'new', 'ignore'].includes(action!)) throw fail(400, '검토 방법을 확인해주세요.');
  const guestId = str(body, 'guestId') || null;
  if (action === 'link' && !guestId) throw fail(400, '연결할 고객을 선택해주세요.');
  return ok(await reviewGuestReservation(id, guestId, auth.user.id, action as 'link' | 'new' | 'ignore'));
}, { admin: true });

// Explicit, bounded backfill. Reads existing local data only; never creates Beds24 bookings.
export const POST = withAuth('guest-history/reconcile', async req => {
  const body = await readJson(req);
  const stage = str(body, 'stage') || 'guests';
  const cursor = str(body, 'cursor');
  if (!['guests', 'events', 'bookings'].includes(stage)) throw fail(400, '잘못된 단계입니다.');
  const paging = { orderBy: { id: 'asc' as const }, take: 25, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) };
  let ids: string[] = [];
  if (stage === 'guests') {
    const rows = await prisma.guest.findMany(paging);
    for (const row of rows) await prisma.guest.update({ where: { id: row.id }, data: normalizeIdentity(row) });
    ids = rows.map(r => r.id);
  } else if (stage === 'events') {
    const rows = await prisma.event.findMany({ ...paging, where: { type: 'reservation', channelId: 'beds24' } });
    for (const row of rows) {
      const saved = await prisma.guestReservation.findUnique({ where: { key: `${row.propertyId}:beds24:${row.originalUid}` } });
      // Do not replace authoritative cancellation/no-show data with a calendar snapshot.
      if (!saved) await recordEvent(row);
    }
    ids = rows.map(r => r.id);
  } else {
    const rows = await prisma.booking.findMany(paging);
    for (const row of rows) await recordBooking(row);
    ids = rows.map(r => r.id);
  }
  return ok({ count: ids.length, nextCursor: ids.length === 25 ? ids.at(-1) : null, nextStage: ids.length === 25 ? stage : stage === 'guests' ? 'events' : stage === 'events' ? 'bookings' : null });
}, { admin: true });
