import { prisma } from '@/lib/prisma';
import { getPropertyDisplay, propertyImagePaths, slugCandidates } from '@/lib/property-display';
import { withErrors, ok, fail } from '@/lib/core/http';

// GET /api/public/properties/{idOrSlug}
// idOrSlug 는 UUID 또는 slug. coming_soon 상태 지점은 bookedDates 를 빈 배열로 두고 status 로 UI 가 판단.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrors<{ id: string }>('public/properties/id', async (_req, { params }) => {
  const key = params.id.trim();

  // slugCandidates — 리네임된 지점은 구/신 슬러그 양쪽으로 찾는다.
  const property = await prisma.property.findFirst({
    where: UUID_REGEX.test(key) ? { id: key } : { slug: { in: slugCandidates(key) } },
  });
  if (!property) throw fail(404, 'Property not found');

  const display = property.slug ? getPropertyDisplay(property.slug) : null;
  const images = display ? propertyImagePaths(display).map((p) => p.src) : [];

  // coming_soon 이면 예약 데이터 조회 스킵.
  let bookedDates: { start: string; end: string; type: string }[] = [];
  if (property.status === 'active') {
    const [events, bookings] = await Promise.all([
      prisma.event.findMany({ where: { propertyId: property.id }, select: { startDate: true, endDate: true, type: true } }),
      prisma.booking.findMany({ where: { propertyId: property.id, status: 'confirmed' }, select: { checkIn: true, checkOut: true } }),
    ]);
    bookedDates = [
      ...events.map((e) => ({ start: e.startDate, end: e.endDate, type: e.type })),
      ...bookings.map((b) => ({ start: b.checkIn, end: b.checkOut, type: 'reservation' })),
    ];
  }

  return ok({
    id: property.id,
    slug: property.slug,
    status: property.status,
    openingDate: property.openingDate,
    name: property.name,
    timezone: property.timezone,
    permit: null,
    imageUrl: images[0] ?? null,
    images,
    description: property.description ?? null,
    checkInTime: display?.checkInTime ?? null,
    checkOutTime: display?.checkOutTime ?? null,
    maxGuests: property.maxGuests ?? null,
    region: display?.region ?? null,
    addressKo: display?.addressKo ?? null,
    catchphrase: display?.catchphrase ?? null,
    bookedDates,
  });
});
