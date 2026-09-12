import { prisma } from '@/lib/prisma';
import { checkoutConfig } from '@/lib/payments/config';
import { getPropertyDisplay, propertyImagePaths, slugCandidates } from '@/lib/property-display';
import { withErrors, ok, fail } from '@/lib/core/http';

// GET /api/public/properties/{idOrSlug}
// idOrSlug 는 UUID 또는 slug. 판매 일정은 /api/public/stay-calendar 에서 Beds24 기준으로 조회한다.
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

  const checkoutMethods = (['card', 'paypal'] as const).filter(method => {
    try { checkoutConfig(property.id, method); return method !== 'paypal' || Number(process.env.CHECKOUT_KRW_PER_USD) > 0; }
    catch { return false; }
  });
  return ok({
    checkoutMethods,
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
  });
});
