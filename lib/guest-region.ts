import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';
export type GuestRegion = { label: string; source: 'reservation' | 'phone' | 'unknown'; countryCode: string | null; callingCode: string | null };
const countries = getCountries();
const ko = new Intl.DisplayNames(['ko'], { type: 'region' });
const en = new Intl.DisplayNames(['en'], { type: 'region' });
export function residenceCountry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  if (countries.some(c => c === upper)) return upper;
  return countries.find(c => en.of(c)?.toLowerCase() === v.toLowerCase() || ko.of(c) === v) || null;
}
// Beds24 Booking schema: country2 = two-letter selector, country = free text address country.
export function bedsResidenceCountry(booking: Record<string, unknown>): string | undefined {
  return residenceCountry(booking.country2) || residenceCountry(booking.country) || undefined;
}
export function phoneRegion(phone?: string | null): GuestRegion {
  const unknown: GuestRegion = { label: '확인 불가', source: 'unknown', countryCode: null, callingCode: null };
  const raw = (phone || '').trim();
  // No default country: a domestic number, missing + prefix or masked value cannot establish a region.
  if (!/^\+[\d\s().-]+$/.test(raw)) return unknown;
  const parsed = parsePhoneNumberFromString(raw);
  if (!parsed || !parsed.isPossible()) return unknown;
  const code = parsed.countryCallingCode;
  const regions = countries.filter(c => getCountryCallingCode(c) === code);
  if (regions.length !== 1) return { label: regions.length ? `공동 사용 지역 (+${code})` : `국제 공용 번호 (+${code})`, source: 'phone', countryCode: null, callingCode: code };
  return { label: ko.of(regions[0]) || regions[0], source: 'phone', countryCode: regions[0], callingCode: code };
}
export function guestRegion(phone: string | null | undefined, history: { residenceCountry?: string | null; checkIn: string }[]): GuestRegion {
  const country = [...history].sort((a, b) => b.checkIn.localeCompare(a.checkIn)).map(r => residenceCountry(r.residenceCountry)).find(Boolean);
  return country ? { label: ko.of(country) || country, source: 'reservation', countryCode: country, callingCode: null } : phoneRegion(phone);
}
