import 'server-only';
import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/core/errors';
import { propertyAllowsModule } from '@/lib/operational-access';
import { slugCandidates } from '@/lib/property-display';
import { optimizedPropertyImages } from '@/lib/property-images';
import { propertyPublicInfo } from '@/lib/property-public-info';
import { checkoutConfig } from '@/lib/payments/config';
import { stayOptionPolicy } from '@/lib/payments/stay-options';
import { readRefundPolicy, type RefundPolicy } from '@/lib/refund-policy';

export interface PublicBookingProperty {
  id: string;
  slug: string | null;
  status: string;
  openingDate: string | null;
  name: string;
  timezone: string;
  permit: null;
  imageUrl: string | null;
  images: string[];
  description: string | null;
  checkInTime: string;
  checkOutTime: string;
  baseGuests: number;
  maxGuests: number | null;
  region: string;
  addressKo: string;
  catchphrase: string;
  regionEn?: string; addressEn?: string; catchphraseEn?: string; descriptionEn?: string;
  amenities: string[];
  checkoutMethods: Array<'card' | 'paypal'>;
  stayOptionPolicy: ReturnType<typeof stayOptionPolicy>;
  refundPolicy: RefundPolicy | null;
}

export async function getPublicBookingProperty(idOrSlug: string): Promise<PublicBookingProperty> {
  const key = idOrSlug.trim();
  if (!key || key.length > 128) throw fail(404, 'Property not found');
  const property = await prisma.property.findFirst({
    where: { OR: [{ id: key }, { slug: { in: slugCandidates(key) } }] },
    select: {
      id: true, slug: true, status: true, openingDate: true, name: true, timezone: true,
      description: true, maxGuests: true, publicInfo: true, refundPolicy: true, featureOverrides: true,
      organization: { select: { status: true, features: true } },
    },
  });
  if (!property) throw fail(404, 'Property not found');
  if (!['active', 'coming_soon'].includes(property.status) || !propertyAllowsModule(property, 'reservations')) {
    throw fail(404, '현재 공개되지 않은 숙소입니다.');
  }
  const display = propertyPublicInfo(property);
  const images = optimizedPropertyImages(property.slug, display.images);
  const checkoutMethods = (['card', 'paypal'] as const).filter(method => {
    try {
      checkoutConfig(property.id, method, property.slug);
      return method !== 'paypal' || Number(process.env.CHECKOUT_KRW_PER_USD) > 0;
    } catch { return false; }
  });
  return {
    id: property.id, slug: property.slug, status: property.status, openingDate: property.openingDate,
    name: property.name, timezone: property.timezone, permit: null,
    imageUrl: images[0] ?? null, images, description: property.description ?? null,
    checkInTime: display.checkInTime, checkOutTime: display.checkOutTime,
    baseGuests: display.baseGuests, maxGuests: property.maxGuests ?? null,
    region: display.region, addressKo: display.addressKo, catchphrase: display.catchphrase,
    regionEn: display.regionEn, addressEn: display.addressEn, catchphraseEn: display.catchphraseEn, descriptionEn: display.descriptionEn,
    amenities: display.amenities, checkoutMethods, stayOptionPolicy: stayOptionPolicy(property.slug),
    refundPolicy: readRefundPolicy(property.refundPolicy),
  };
}
