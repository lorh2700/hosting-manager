import { prisma } from '@/lib/prisma';
import { withErrors, ok } from '@/lib/core/http';
import { getPropertyDisplay } from '@/lib/property-display';
import { stayOptionPolicy } from '@/lib/payments/stay-options';

// 공개 숙소 목록 (예약 페이지). 표시용 최소 필드만 노출한다.
export const GET = withErrors('public/properties', async () => {
  const properties = await prisma.property.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, timezone: true, description: true, slug: true, status: true, maxGuests: true, basePrice: true },
  });
  return ok(properties.map(p => ({ ...p, basePrice: p.basePrice != null && Number(p.basePrice) > 0 ? Number(p.basePrice) : null,
    maxPets: stayOptionPolicy(p.slug)?.maxPets ?? null, imageUrl: null, images: [], region: p.slug ? getPropertyDisplay(p.slug)?.region ?? null : null, description: p.description ?? null })));
});
