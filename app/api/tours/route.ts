import { prisma } from '@/lib/prisma';
import { authorizeTour } from '@/lib/auth';
import { uniqueSlug } from '@/lib/slug';
import { withAuth, ok, created, fail, MESSAGES, readJson, str, requireQuery } from '@/lib/core/http';

// Allowed fields for client-supplied input — guards against mass assignment.
const TOUR_WRITABLE_FIELDS = [
  'title', 'slug', 'category', 'description', 'meetingPoint',
  'durationMin', 'basePrice', 'maxGroupSize', 'operatorId',
  'images', 'isActive',
] as const;

type TourWritable = Partial<Record<typeof TOUR_WRITABLE_FIELDS[number], unknown>>;

function pickWritable(body: Record<string, unknown>): TourWritable {
  const out: TourWritable = {};
  for (const key of TOUR_WRITABLE_FIELDS) if (key in body) out[key] = body[key];
  if ('images' in out && !Array.isArray(out.images)) delete out.images;
  return out;
}

export const GET = withAuth('tours', async (_req, { auth }) => {
  const tours = await prisma.tour.findMany({
    where: auth.isAdmin ? undefined : { ownerId: auth.session.userId },
    orderBy: { createdAt: 'desc' },
    include: { operator: { select: { id: true, name: true } }, _count: { select: { schedules: true, bookings: true } } },
  });
  return ok(tours.map(t => ({
    id: t.id, title: t.title, slug: t.slug, category: t.category, description: t.description,
    meetingPoint: t.meetingPoint, durationMin: t.durationMin,
    basePrice: t.basePrice ? Number(t.basePrice) : null,
    maxGroupSize: t.maxGroupSize, images: t.images, isActive: t.isActive,
    operator: t.operator, operatorId: t.operatorId,
    scheduleCount: t._count.schedules, bookingCount: t._count.bookings, createdAt: t.createdAt,
  })));
});

export const POST = withAuth('tours', async (req, { auth }) => {
  const body = await readJson(req);
  const title = str(body, 'title', { required: true })!;

  // If linking to an operator, ensure the user owns it.
  if (body.operatorId) {
    const owned = await prisma.tourOperator.findFirst({
      where: { id: String(body.operatorId), ...(auth.isAdmin ? {} : { ownerId: auth.session.userId }) },
      select: { id: true },
    });
    if (!owned) throw fail(403, '운영업체에 대한 권한이 없습니다.');
  }

  const slug = str(body, 'slug');
  const tour = await prisma.tour.create({
    data: {
      ownerId: auth.session.userId,
      title,
      slug: slug && slug.trim() ? slug.trim() : uniqueSlug(title),
      category: (body.category as string | undefined) ?? null,
      description: (body.description as string | undefined) ?? null,
      meetingPoint: (body.meetingPoint as string | undefined) ?? null,
      durationMin: (body.durationMin as number | undefined) ?? null,
      basePrice: (body.basePrice as number | undefined) ?? null,
      maxGroupSize: (body.maxGroupSize as number | undefined) ?? null,
      operatorId: (body.operatorId as string | undefined) ?? null,
      images: Array.isArray(body.images) ? (body.images as string[]) : [],
      isActive: (body.isActive as boolean | undefined) ?? true,
    },
  });
  return created(tour);
});

export const PUT = withAuth('tours', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;
  if (!(await authorizeTour(id, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);

  const data = pickWritable(body);
  // operatorId change → must own the new operator (unless setting to null)
  if (data.operatorId) {
    const owned = await prisma.tourOperator.findFirst({
      where: { id: data.operatorId as string, ...(auth.isAdmin ? {} : { ownerId: auth.session.userId }) },
      select: { id: true },
    });
    if (!owned) throw fail(403, '운영업체에 대한 권한이 없습니다.');
  }

  return ok(await prisma.tour.update({ where: { id }, data: data as Parameters<typeof prisma.tour.update>[0]['data'] }));
});

export const DELETE = withAuth('tours', async (req, { auth }) => {
  const id = requireQuery(req, 'id');
  if (!(await authorizeTour(id, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);

  const bookingCount = await prisma.tourBooking.count({ where: { tourId: id } });
  if (bookingCount > 0) throw fail(409, `예약이 있는 투어는 삭제할 수 없습니다. (${bookingCount}건). 비활성화로 전환하세요.`);

  await prisma.tour.delete({ where: { id } });
  return ok({ success: true });
});
