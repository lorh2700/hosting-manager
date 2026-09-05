import { prisma } from '@/lib/prisma';
import { authorizeTour, authorizeTourDurationOption } from '@/lib/auth';
import { withAuth, withErrors, ok, created, fail, MESSAGES, readJson, str, requireQuery } from '@/lib/core/http';

type Params = { id: string };

function parseDuration(v: unknown): number {
  const dur = Number(v);
  if (!Number.isFinite(dur) || dur <= 0 || dur > 24 * 60) throw fail(400, 'durationMin이 올바르지 않습니다.');
  return dur;
}
function parsePrice(v: unknown): number {
  const price = Number(v);
  if (!Number.isFinite(price) || price < 0) throw fail(400, 'price가 올바르지 않습니다.');
  return price;
}

// 공개 예약 페이지도 읽으므로 인증 없음.
export const GET = withErrors<Params>('tours/duration-options', async (_req, { params }) => {
  const options = await prisma.tourDurationOption.findMany({ where: { tourId: params.id }, orderBy: [{ sortOrder: 'asc' }, { durationMin: 'asc' }] });
  return ok(options.map(o => ({ id: o.id, label: o.label, durationMin: o.durationMin, price: Number(o.price), sortOrder: o.sortOrder })));
});

export const POST = withAuth<Params>('tours/duration-options', async (req, { auth, params }) => {
  if (!(await authorizeTour(params.id, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);
  const body = await readJson(req);
  if (!body.durationMin || body.price === undefined || body.price === null) throw fail(400, 'durationMin과 price는 필수입니다.');

  const label = str(body, 'label');
  return created(await prisma.tourDurationOption.create({
    data: {
      tourId: params.id,
      label: label && label.trim() ? label.trim() : null,
      durationMin: parseDuration(body.durationMin),
      price: parsePrice(body.price),
      sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    },
  }));
});

export const PUT = withAuth('tours/duration-options', async (req, { auth }) => {
  const body = await readJson(req);
  const optionId = str(body, 'optionId', { required: true })!;
  if (!(await authorizeTourDurationOption(optionId, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);

  const data: { label?: string | null; durationMin?: number; price?: number; sortOrder?: number } = {};
  if (body.label !== undefined) data.label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null;
  if (body.durationMin !== undefined) data.durationMin = parseDuration(body.durationMin);
  if (body.price !== undefined) data.price = parsePrice(body.price);
  if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) data.sortOrder = Number(body.sortOrder);

  return ok(await prisma.tourDurationOption.update({ where: { id: optionId }, data }));
});

export const DELETE = withAuth('tours/duration-options', async (req, { auth }) => {
  const optionId = requireQuery(req, 'optionId');
  if (!(await authorizeTourDurationOption(optionId, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);

  const usage = await prisma.tourBooking.count({ where: { durationOptionId: optionId } });
  if (usage > 0) throw fail(409, `예약(${usage}건)이 있는 코스는 삭제할 수 없습니다. 가격만 수정하세요.`);

  await prisma.tourDurationOption.delete({ where: { id: optionId } });
  return ok({ success: true });
});
