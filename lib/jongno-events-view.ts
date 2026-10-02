import { eventHasOccurrenceInRange, isJongnoDate, jongnoToday, type JongnoEventDTO } from './jongno-events';

export const JONGNO_CATEGORY_LABELS = {
  festival: { ko: '축제', en: 'Festivals' }, exhibition: { ko: '전시', en: 'Exhibitions' },
  performance: { ko: '공연', en: 'Performances' }, palace: { ko: '궁궐', en: 'Palaces' },
  experience: { ko: '체험', en: 'Experiences' },
} as const;
export const JONGNO_AREA_LABELS = {
  bukchon: { ko: '북촌', en: 'Bukchon' }, insadong: { ko: '인사동', en: 'Insadong' },
  seochon: { ko: '서촌', en: 'Seochon' }, daehakro: { ko: '대학로', en: 'Daehakro' },
  other: { ko: '종로 기타', en: 'Other Jongno areas' },
} as const;
export interface JongnoEventsResponse {
  events: JongnoEventDTO[];
  hasMore: boolean;
  nextCursor: string | null;
  range: { from: string; to: string };
}
export async function readJongnoEvents(query: string, signal: AbortSignal): Promise<JongnoEventsResponse> {
  const response = await fetch(`/api/public/jongno-events?${query}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Events unavailable');
  const data = await response.json() as JongnoEventsResponse;
  if (!Array.isArray(data.events) || !data.range || !isJongnoDate(data.range.from) || !isJongnoDate(data.range.to)
    || data.range.from > data.range.to || typeof data.hasMore !== 'boolean'
    || (data.nextCursor !== null && typeof data.nextCursor !== 'string')) throw new Error('Invalid events response');
  return data;
}
export function jongnoCalendarHref(start: string | null | undefined, end: string | null | undefined, language: 'ko' | 'en') {
  const query = new URLSearchParams({ lang: language });
  if (isJongnoDate(start) && isJongnoDate(end) && start <= end) { query.set('from', start); query.set('to', end); }
  return `/guide/jongno-events?${query}`;
}
/** Inclusive: check-out day may still be useful for a guest's plans. */
export function jongnoRangeDays(from: string, to: string) {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
}
export function jongnoRecommendationQuery(start: string | null | undefined, end: string | null | undefined) {
  if (!isJongnoDate(start) || !isJongnoDate(end) || start > end || jongnoRangeDays(start, end) > 93) return '';
  return new URLSearchParams({ from: start, to: end, limit: '100' }).toString();
}
export function selectJongnoRecommendations(events: JongnoEventDTO[], from: string, to: string) {
  if (!isJongnoDate(from) || !isJongnoDate(to) || from > to) return [];
  return events.filter(event => event.status === 'published' && eventHasOccurrenceInRange(event, from, to)).slice(0, 3);
}
export function jongnoDateLabel(date: string, language: 'ko' | 'en', options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}
export function jongnoVerifiedDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return jongnoToday(new Date(value));
}
export function jongnoEventTitle(event: JongnoEventDTO, language: 'ko' | 'en') {
  return language === 'en' ? event.titleEn || event.titleKo : event.titleKo || event.titleEn;
}
export function jongnoEventFee(event: JongnoEventDTO, language: 'ko' | 'en') {
  if (event.feeText) return event.feeText;
  return event.feeType === 'free' ? (language === 'en' ? 'Free' : '무료') : event.feeType === 'paid' ? (language === 'en' ? 'Paid' : '유료') : (language === 'en' ? 'Check fees' : '요금 확인 필요');
}
export function jongnoMonthDays(month: string) {
  const first = `${month}-01`;
  if (!isJongnoDate(first)) return [];
  const at = new Date(`${first}T00:00:00Z`), next = new Date(at);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const days: string[] = [];
  for (; at < next; at.setUTCDate(at.getUTCDate() + 1)) days.push(at.toISOString().slice(0, 10));
  return days;
}
export function moveJongnoMonth(month: string, amount: number) {
  if (!isJongnoDate(`${month}-01`)) return month;
  const value = new Date(`${month}-01T00:00:00Z`); value.setUTCMonth(value.getUTCMonth() + amount);
  const next = value.toISOString().slice(0, 7);
  return isJongnoDate(`${next}-01`) ? next : month;
}
