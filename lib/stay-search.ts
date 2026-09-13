import { todayKst } from './dates';
export type StaySearch = { checkIn: string; checkOut: string; guests: number; pets: number };
export type StaySearchResult = { slug: string; status: 'available' | 'unavailable' | 'error'; priceKrw?: number; nights?: number; includesAllFees?: boolean };
export function parseStaySearch(raw: unknown): StaySearch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const checkIn = String(value.checkIn ?? ''), checkOut = String(value.checkOut ?? '');
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (!valid(checkIn) || !valid(checkOut)) return null;
  const nights = (Date.parse(checkOut) - Date.parse(checkIn)) / 86400000;
  const guests = Number(value.guests), pets = Number(value.pets ?? 0);
  if (checkIn < todayKst() || nights < 1 || nights > 30 || !Number.isInteger(guests) || guests < 1 || guests > 20 || !Number.isInteger(pets) || pets < 0 || pets > 2) return null;
  return { checkIn, checkOut, guests, pets };
}
export function staySearchQuery(search: StaySearch) {
  return new URLSearchParams({ checkIn: search.checkIn, checkOut: search.checkOut, guests: String(search.guests), pets: String(search.pets) }).toString();
}
