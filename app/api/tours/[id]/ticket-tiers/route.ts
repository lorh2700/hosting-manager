import { prisma } from '@/lib/prisma';
import { authorizeTour } from '@/lib/auth';
import { withAuth, withErrors, ok, created, fail, MESSAGES, readJson, str, requireQuery } from '@/lib/core/http';

type Params = { id: string };

function parsePrice(v: unknown): number {
  const price = Number(v);
  if (!Number.isFinite(price) || price < 0) throw fail(400, 'price 가 올바르지 않습니다.');
  return price;
}

// 공개 예약 페이지도 읽으므로 인증 없음.
export const GET = withErrors<Params>('tours/ticket-tiers', async (_req, { params }) => {
  const tiers = await prisma.tourTicketTier.findMany({ where: { tourId: params.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  return ok(tiers.map(t => ({ id: t.id, label: t.label, price: Number(t.price), notes: t.notes, sortOrder: t.sortOrder })));
});

export const POST = withAuth<Params>('tours/ticket-tiers', async (req, { auth, params }) => {
  if (!(await authorizeTour(params.id, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);
  const body = await readJson(req);
  const label = str(body, 'label', { required: true })!.trim();
  if (body.price === undefined || body.price === null) throw fail(400, 'price는 필수입니다.');

  return created(await prisma.tourTicketTier.create({
    data: {
      tourId: params.id,
      label,
      price: parsePrice(body.price),
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    },
  }));
});

async function requireTierOwner(tierId: string, auth: { session: { userId: string }; isAdmin: boolean }) {
  const tier = await prisma.tourTicketTier.findUnique({ where: { id: tierId }, select: { tourId: true } });
  if (!tier) throw fail(404, MESSAGES.notFound);
  if (!(await authorizeTour(tier.tourId, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);
}

export const PUT = withAuth<Params>('tours/ticket-tiers', async (req, { auth }) => {
  const body = await readJson(req);
  const tierId = str(body, 'tierId', { required: true })!;
  await requireTierOwner(tierId, auth);

  const data: { label?: string; price?: number; notes?: string | null; sortOrder?: number } = {};
  if (body.label !== undefined) data.label = String(body.label).trim();
  if (body.price !== undefined) data.price = parsePrice(body.price);
  if (body.notes !== undefined) data.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
  if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) data.sortOrder = Number(body.sortOrder);

  return ok(await prisma.tourTicketTier.update({ where: { id: tierId }, data }));
});

export const DELETE = withAuth<Params>('tours/ticket-tiers', async (req, { auth }) => {
  const tierId = requireQuery(req, 'tierId');
  await requireTierOwner(tierId, auth);
  await prisma.tourTicketTier.delete({ where: { id: tierId } });
  return ok({ success: true });
});
