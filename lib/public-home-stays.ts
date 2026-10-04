import { PROPERTY_DISPLAY_ORDER } from './property-display';
import type { StaySearchResult } from './stay-search';

export type PublicStayCard = {
  slug: string; name: string; status: 'active' | 'coming_soon'; region: string;
  maxGuests: number; maxPets?: number | null; openingLabel?: string | null;
  images: string[]; basePrice?: number | null;
};

// Treat malformed responses as a failed load, rather than an empty property list.
export function parsePublicStayCards(raw: unknown): PublicStayCard[] | null {
  if (!Array.isArray(raw)) return null;
  const cards: PublicStayCard[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const value = item as Record<string, unknown>;
    if (typeof value.slug !== 'string' || !value.slug.trim() || typeof value.name !== 'string' || !value.name.trim()
      || !['active', 'coming_soon', 'closed'].includes(String(value.status)) || !Array.isArray(value.images)
      || value.images.some(image => typeof image !== 'string')) return null;
    if (value.status === 'closed' || seen.has(value.slug)) continue;
    seen.add(value.slug);
    cards.push({
      slug: value.slug, name: value.name, status: value.status as PublicStayCard['status'],
      region: typeof value.region === 'string' ? value.region : '',
      maxGuests: Number.isInteger(value.maxGuests) && Number(value.maxGuests) > 0 ? Number(value.maxGuests) : 2,
      maxPets: Number.isInteger(value.maxPets) && Number(value.maxPets) >= 0 ? Number(value.maxPets) : null,
      openingLabel: typeof value.openingLabel === 'string' ? value.openingLabel : null,
      images: value.images as string[],
      basePrice: Number.isFinite(value.basePrice) && Number(value.basePrice) > 0 ? Number(value.basePrice) : null,
    });
  }
  return cards.sort((a, b) => {
    const ai = PROPERTY_DISPLAY_ORDER.indexOf(a.slug), bi = PROPERTY_DISPLAY_ORDER.indexOf(b.slug);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
}

export function parsePublicStayResults(raw: unknown): StaySearchResult[] | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { results?: unknown }).results)) return null;
  const results = (raw as { results: unknown[] }).results;
  if (results.some(item => !item || typeof item !== 'object' || Array.isArray(item)
    || typeof (item as StaySearchResult).slug !== 'string'
    || !['available', 'unavailable', 'error'].includes((item as StaySearchResult).status))) return null;
  return results.map(item => {
    const result = item as StaySearchResult;
    // An incomplete quote must never be advertised as confirmed availability.
    if (result.status === 'available' && (!Number.isFinite(result.priceKrw) || Number(result.priceKrw) <= 0
      || !Number.isInteger(result.nights) || Number(result.nights) <= 0)) return { slug: result.slug, status: 'error' };
    return result;
  });
}

export function visiblePublicStays(cards: PublicStayCard[], search: { active: boolean; loading: boolean; failed: boolean; results: StaySearchResult[] }): PublicStayCard[] {
  if (!search.active) return cards;
  const active = cards.filter(card => card.status === 'active');
  if (search.loading || search.failed) return active;
  // Keep unconfirmed stays available to browse, clearly labelled by the UI.
  // Only a confirmed "unavailable" result may hide a stay for these dates.
  return active.filter(card => !search.results.some(result => result.slug === card.slug && result.status === 'unavailable'))
    .sort((a, b) => Number(search.results.some(result => result.slug === b.slug && result.status === 'available'))
      - Number(search.results.some(result => result.slug === a.slug && result.status === 'available')));
}
