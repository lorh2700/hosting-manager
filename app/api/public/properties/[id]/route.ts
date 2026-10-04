import { stayOptionPolicy } from '@/lib/payments/stay-options';
import { prisma } from '@/lib/prisma';
import { checkoutConfig } from '@/lib/payments/config';
import { slugCandidates } from '@/lib/property-display';
import { propertyPublicInfo } from '@/lib/property-public-info';
import { propertyAllowsModule } from '@/lib/operational-access';
import { withErrors, ok, fail } from '@/lib/core/http';

// GET /api/public/properties/{idOrSlug}
// idOrSlug 는 UUID 또는 slug. 판매 일정은 /api/public/stay-calendar 에서 Beds24 기준으로 조회한다.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrors<{ id: string }>('public/properties/id', async (_req, { params }) => {
  const key = params.id.trim();

  // slugCandidates — 리네임된 지점은 구/신 슬러그 양쪽으로 찾는다.
  const property = await prisma.property.findFirst({
    where: UUID_REGEX.test(key) ? { id: key } : { slug: { in: slugCandidates(key) } },
    include: { organization: { select: { status: true, features: true } } },
  });
  if (!property) throw fail(404, 'Property not found');
  if (property.status === 'closed' || !propertyAllowsModule(property, 'reservations')) throw fail(404, '현재 공개되지 않은 숙소입니다.');

  const display = propertyPublicInfo(property);
  const images = display.images;

  const checkoutMethods = (['card', 'paypal'] as const).filter(method => {
    try { checkoutConfig(property.id, method, property.slug); return method !== 'paypal' || Number(process.env.CHECKOUT_KRW_PER_USD) > 0; }
    catch { return false; }
  });
  return ok({
    checkoutMethods,
    stayOptionPolicy: stayOptionPolicy(property.slug),
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
