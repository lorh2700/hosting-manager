import { z } from 'zod';
import { getPropertyDisplay, propertyImagePaths } from './property-display';

const imageUrl = z.string().trim().max(2000).refine(value => {
  try {
    if (value.startsWith('/images/')) return /^\/images\/[\w./%-]+$/.test(value) && !decodeURIComponent(value).split('/').some(segment => segment === '..' || segment === '.');
    const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}, '사진은 업로드한 HTTPS 주소 또는 /images/ 경로를 사용해 주세요.');
export const publicInfoSchema = z.object({
  region: z.string().trim().max(80).default(''), addressKo: z.string().trim().max(300).default(''), catchphrase: z.string().trim().max(160).default(''),
  checkInTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('15:00'), checkOutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('11:00'),
  images: z.array(imageUrl).max(24).default([]),
}).strict();
export type PropertyPublicInfo = z.infer<typeof publicInfoSchema>;

export function propertyPublicInfo(property: { slug?: string | null; publicInfo?: unknown }): PropertyPublicInfo {
  const display = property.slug ? getPropertyDisplay(property.slug) : null;
  const original = { region: display?.region || '', addressKo: display?.addressKo || '', catchphrase: display?.catchphrase || '', checkInTime: display?.checkInTime || '15:00', checkOutTime: display?.checkOutTime || '11:00', images: display ? propertyImagePaths(display).map(item => item.src) : [] };
  const stored = property.publicInfo && typeof property.publicInfo === 'object' && !Array.isArray(property.publicInfo) ? property.publicInfo : {};
  const parsed = publicInfoSchema.safeParse({ ...original, ...stored });
  return parsed.success ? parsed.data : original;
}

export function publishRequirements(property: { name: string; slug?: string | null; description?: string | null; maxGuests?: number | null; beds24PropId?: string | null; beds24RoomId?: string | null; publicInfo?: unknown }): string[] {
  const info = propertyPublicInfo(property);
  const missing: string[] = [];
  if (!property.name.trim()) missing.push('숙소 이름');
  if (!property.slug) missing.push('예약 페이지 주소');
  if (!property.description?.trim()) missing.push('숙소 소개');
  if (!info.region) missing.push('지역');
  if (!info.addressKo) missing.push('주소');
  if (!info.images.length) missing.push('사진');
  if (!property.maxGuests || property.maxGuests < 2 || property.maxGuests > 10) missing.push('최대 투숙 인원(2~10인)');
  if (!property.beds24PropId || !/^[1-9]\d*$/.test(property.beds24PropId)) missing.push('Beds24 숙소 ID');
  if (!property.beds24RoomId || !/^[1-9]\d*$/.test(property.beds24RoomId)) missing.push('Beds24 객실 ID');
  return missing;
}

export function publicListing(property: { id: string; name: string; slug?: string | null; status: string; description?: string | null; maxGuests?: number | null; basePrice?: unknown; openingDate?: string | null; timezone: string; publicInfo?: unknown }) {
  const info = propertyPublicInfo(property);
  return { ...info, id: property.id, name: property.name, slug: property.slug, status: property.status, timezone: property.timezone, description: property.description || '', maxGuests: property.maxGuests ?? 2, basePrice: property.basePrice != null && Number(property.basePrice) > 0 ? Number(property.basePrice) : null, imageUrl: info.images[0] ?? null, openingLabel: property.openingDate || null };
}
