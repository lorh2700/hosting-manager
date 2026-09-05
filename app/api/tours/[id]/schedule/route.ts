import { prisma } from '@/lib/prisma';
import { authorizeTour, authorizeTourSchedule } from '@/lib/auth';
import { withAuth, ok, created, fail, MESSAGES, DATE_RE, readJson, str, query, requireQuery } from '@/lib/core/http';

type Params = { id: string };
const TIME_RE = /^\d{2}:\d{2}$/;

export const GET = withAuth<Params>('tours/schedule', async (req, { auth, params }) => {
  if (!(await authorizeTour(params.id, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);
  const from = query(req, 'from');
  const to = query(req, 'to');
  return ok(await prisma.tourSchedule.findMany({
    where: { tourId: params.id, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  }));
});

interface BulkSlot { date: string; startTime: string; capacity: number }

export const POST = withAuth<Params>('tours/schedule', async (req, { auth, params }) => {
  if (!(await authorizeTour(params.id, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);
  const body = await readJson(req);
  const slots: BulkSlot[] = Array.isArray(body.slots) ? (body.slots as BulkSlot[]) : [];
  if (slots.length === 0) throw fail(400, '추가할 슬롯이 없습니다.');
  if (slots.length > 1000) throw fail(400, '한 번에 최대 1000개까지 등록할 수 있습니다.');
  for (const s of slots) {
    if (typeof s.date !== 'string' || !DATE_RE.test(s.date)) throw fail(400, '날짜 형식이 올바르지 않습니다.');
    if (typeof s.startTime !== 'string' || !TIME_RE.test(s.startTime)) throw fail(400, '시간 형식이 올바르지 않습니다.');
  }

  const result = await prisma.tourSchedule.createMany({
    data: slots.map(s => ({ tourId: params.id, date: s.date, startTime: s.startTime, capacity: Math.max(1, Math.min(1000, Number(s.capacity) || 1)) })),
    skipDuplicates: true,
  });
  return created({ created: result.count });
});

export const PUT = withAuth('tours/schedule', async (req, { auth }) => {
  const body = await readJson(req);
  const scheduleId = str(body, 'scheduleId', { required: true })!;
  if (!(await authorizeTourSchedule(scheduleId, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);

  const data: { capacity?: number; status?: string; note?: string | null } = {};
  if (body.capacity !== undefined) data.capacity = Math.max(1, Math.min(1000, Number(body.capacity)));
  if (body.status !== undefined) {
    if (body.status !== 'open' && body.status !== 'closed' && body.status !== 'cancelled') throw fail(400, '잘못된 status 값입니다.');
    data.status = body.status;
  }
  if (body.note !== undefined) data.note = typeof body.note === 'string' ? body.note : null;

  return ok(await prisma.tourSchedule.update({ where: { id: scheduleId }, data }));
});

export const DELETE = withAuth('tours/schedule', async (req, { auth }) => {
  const scheduleId = requireQuery(req, 'scheduleId');
  if (!(await authorizeTourSchedule(scheduleId, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);

  const schedule = await prisma.tourSchedule.findUnique({ where: { id: scheduleId }, select: { bookedCount: true } });
  if (!schedule) throw fail(404, MESSAGES.notFound);
  if (schedule.bookedCount > 0) throw fail(409, '예약이 있는 슬롯은 삭제할 수 없습니다. 마감 처리하세요.');

  await prisma.tourSchedule.delete({ where: { id: scheduleId } });
  return ok({ success: true });
});
