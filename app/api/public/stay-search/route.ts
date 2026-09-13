import { prisma } from '@/lib/prisma';
import { withErrors, ok, fail, HttpError } from '@/lib/core/http';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { priceStay } from '@/lib/payments/checkout';
import { stayOptionPolicy } from '@/lib/payments/stay-options';
import { PROPERTY_DISPLAY } from '@/lib/property-display';
import { parseStaySearch, type StaySearchResult } from '@/lib/stay-search';

export const POST = withErrors('public/stay-search', async req => {
  if (!rateLimit(`stay-search:${clientIp(req)}`, 10, 60_000).ok) throw fail(429, '잠시 후 다시 시도해주세요. / Please try again later.');
  const search = parseStaySearch(await req.json());
  if (!search) throw fail(400, '날짜와 인원을 확인해주세요. / Check your dates and guest count.');
  const properties = await prisma.property.findMany({ where: { status: 'active', slug: { in: Object.keys(PROPERTY_DISPLAY).filter(slug => PROPERTY_DISPLAY[slug].status === 'active') } }, select: { id: true, slug: true, maxGuests: true } });
  const results: StaySearchResult[] = [];
  let index = 0;
  // Keep Beds24 requests bounded; a failed stay must not hide the other results.
  await Promise.all([0, 1].map(async () => {
    while (index < properties.length) {
      const property = properties[index++];
      const slug = property.slug!;
      if ((property.maxGuests && search.guests > property.maxGuests) || search.pets > (stayOptionPolicy(slug)?.maxPets ?? 0)) {
        results.push({ slug, status: 'unavailable' }); continue;
      }
      try {
        const price = await priceStay({ ...search, propertyId: property.id });
        results.push({ slug, status: 'available', priceKrw: price.priceKrw, nights: price.nights, includesAllFees: price.includesAllFees });
      } catch (error) {
        results.push({ slug, status: error instanceof HttpError && error.status === 409 ? 'unavailable' : 'error' });
      }
    }
  }));
  const response = ok({ results });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
