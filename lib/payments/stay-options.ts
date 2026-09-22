import { z } from 'zod';
import { getPropertyDisplay } from '@/lib/property-display';
import { fail } from '@/lib/core/errors';

export const BASE_GUESTS = 2;
export const EXTRA_GUEST_FEE_KRW = 30_000;

export function stayOptionPolicy(slug?: string | null) {
  const display = slug ? getPropertyDisplay(slug) : null;
  if (!display || display.slug === 'jarakheon') return null;
  return { baseGuests: BASE_GUESTS, extraGuestFeeKrw: EXTRA_GUEST_FEE_KRW,
    maxPets: display.maxPets ?? 0, petFeesKrw: [0, 70_000, 100_000], unit: 'stay' as const };
}

const snapshotSchema = z.object({ version: z.literal(1), baseGuests: z.literal(2),
  basePriceKrw: z.number().int().nonnegative(), extraGuests: z.number().int().nonnegative(),
  extraGuestFeeKrw: z.number().int().nonnegative(), pets: z.number().int().min(0).max(2),
  petFeeKrw: z.number().int().nonnegative() });
export type StayOptions = z.infer<typeof snapshotSchema>;

export function calculateStayOptions(slug: string | null | undefined, guests: number, pets: number, basePriceKrw: number): StayOptions | null {
  const policy = stayOptionPolicy(slug);
  if (!policy) {
    if (pets) throw fail(400, '이 숙소는 반려견 옵션을 지원하지 않습니다.');
    return null;
  }
  if (!Number.isInteger(pets) || pets < 0 || pets > policy.maxPets) {
    throw fail(400, policy.maxPets === 0 ? '도원재는 반려견 입실이 불가합니다.' : '반려견은 최대 2마리까지 동반 가능합니다.');
  }
  const extraGuests = Math.max(0, guests - policy.baseGuests);
  return { version: 1, baseGuests: 2, basePriceKrw, extraGuests,
    extraGuestFeeKrw: extraGuests * policy.extraGuestFeeKrw, pets, petFeeKrw: policy.petFeesKrw[pets] };
}

export function readStayOptions(value: unknown): StayOptions | null {
  if (value == null) return null; // Orders created before options were introduced.
  return snapshotSchema.parse(value);
}

export function stayOptionsNote(value: unknown) {
  const options = readStayOptions(value);
  return options ? `기준 2인; 추가 ${options.extraGuests}인 ${options.extraGuestFeeKrw} KRW; 반려견 ${options.pets}마리 ${options.petFeeKrw} KRW; 옵션은 숙박 1회 요금` : '';
}
