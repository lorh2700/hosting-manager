import { z } from 'zod';
import { todayKst, addDaysToDateStr } from '@/lib/dates';
import { getPropertyDisplay } from '@/lib/property-display';
import { guestLanguages } from '@/lib/guest-languages';

// Public facts only; never import the private property knowledge base here.
export const guestGuideSlugs = ['byulha', 'anon', 'unwadang', 'hwayeonjae'] as const;
const details: Record<string, { nameEn: string; address: string; addressEn: string }> = {
  byulha: { nameEn: 'Byulha Hanok', address: '서울특별시 종로구 북촌로5나길 7-4', addressEn: '7-4 Bukchon-ro 5na-gil, Jongno-gu, Seoul' },
  anon: { nameEn: 'Anonjae', address: '서울 종로구 삼청로2길 21-4', addressEn: '21-4 Samcheong-ro 2-gil, Jongno-gu, Seoul' },
  unwadang: { nameEn: 'Unwadang', address: '서울 종로구 북촌로11나길 16-20', addressEn: '16-20 Bukchon-ro 11na-gil, Jongno-gu, Seoul' },
  hwayeonjae: { nameEn: 'Hwayeonjae', address: '서울 종로구 북촌로5나길 11', addressEn: '11 Bukchon-ro 5na-gil, Jongno-gu, Seoul' },
};
export function guestGuide(slug: string) {
  const display = getPropertyDisplay(slug);
  if (!display || !Object.hasOwn(details, display.slug)) return null;
  return { slug: display.slug, name: display.name, ...details[display.slug],
    image: display.slug === 'byulha' ? '/images/byulha/DSC02015.webp' : `/images/${display.imageFolder}/${display.imageFiles[0]}.webp`,
    checkIn: display.checkInTime, checkOut: display.checkOutTime, pickupPrice: 100000 };
}

const realDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
export const pickupRequestSchema = z.object({
  id: z.string().uuid(), slug: z.string().min(1).max(60),
  guestName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().regex(/^\+?[\d\s()-]{7,30}$/),
  arrivalDate: realDate,
  arrivalTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  flightNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,3}\s?\d{1,4}[A-Z]?$/),
  passengers: z.number().int().min(1).max(12), luggage: z.number().int().min(0).max(30),
  message: z.string().trim().max(1000).default(''), language: z.enum(guestLanguages),
  consent: z.literal(true), website: z.string().max(0).default(''),
}).strict();
export function arrivalDateAllowed(date: string) { return date >= todayKst() && date <= addDaysToDateStr(todayKst(), 365); }
export const serviceStatuses = ['requested','contacted','confirmed','cancelled'] as const;
export type ServiceStatus = typeof serviceStatuses[number];
export const serviceTransitions: Record<ServiceStatus, readonly ServiceStatus[]> = {
  requested: ['contacted','cancelled'], contacted: ['confirmed','cancelled'], confirmed: ['cancelled'], cancelled: [],
};
