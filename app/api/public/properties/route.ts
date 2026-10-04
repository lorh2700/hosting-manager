import { prisma } from '@/lib/prisma';
import { withErrors, ok } from '@/lib/core/http';
import { stayOptionPolicy } from '@/lib/payments/stay-options';
import { publicListing } from '@/lib/property-public-info';
import { propertyAllowsModule } from '@/lib/operational-access';

// 공개 숙소 목록 (예약 페이지). 표시용 최소 필드만 노출한다.
export const GET = withErrors('public/properties', async () => {
  const properties = await prisma.property.findMany({
    where: { status: { in: ['active', 'coming_soon'] }, slug: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, name: true, timezone: true, description: true, slug: true, status: true, maxGuests: true, basePrice: true, openingDate: true, publicInfo: true, featureOverrides: true, organization: { select: { status: true, features: true } } },
  });
  return ok(properties.filter(p => propertyAllowsModule(p, 'reservations')).map(p => ({ ...publicListing(p), maxPets: stayOptionPolicy(p.slug)?.maxPets ?? null })));
});
