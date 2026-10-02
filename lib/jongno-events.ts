/** Public cultural events are editorial content, independent from reservation Event records. */
export const JONGNO_CATEGORIES = ['festival', 'exhibition', 'performance', 'palace', 'experience'] as const;
export const JONGNO_AREAS = ['bukchon', 'insadong', 'seochon', 'daehakro', 'other'] as const;
export const JONGNO_STATUSES = ['draft', 'published', 'cancelled'] as const;
export const JONGNO_FEE_TYPES = ['free', 'paid', 'unknown'] as const;
export type JongnoCategory = typeof JONGNO_CATEGORIES[number];
export type JongnoArea = typeof JONGNO_AREAS[number];
export type JongnoStatus = typeof JONGNO_STATUSES[number];
export type JongnoFeeType = typeof JONGNO_FEE_TYPES[number];
export interface JongnoEventImage { url: string; alt: string; credit: string; sourceUrl: string }
export interface JongnoEventInput {
  titleKo: string; titleEn: string; descriptionKo: string; descriptionEn: string;
  category: JongnoCategory; area: JongnoArea; venue: string; address: string;
  startDate: string; endDate: string; timeText: string;
  /** 0 = Sunday, 6 = Saturday. Excluded dates are inclusive local Seoul dates. */
  excludedWeekdays: number[]; excludedDates: string[];
  feeType: JongnoFeeType; feeText: string; bookingRequired: boolean;
  officialUrl: string; bookingUrl: string; mapUrl: string; languageText: string;
  images: JongnoEventImage[]; status: JongnoStatus;
  /** Explicit official-schedule confirmation by an administrator. */
  verifiedAt?: string | null;
}
export interface JongnoEventDTO extends JongnoEventInput {
  id: string; verifiedAt: string | null; version: number; updatedAt: string;
}
export interface JongnoEventRange { from: string; to: string }
export interface JongnoEventPage {
  events: JongnoEventDTO[]; hasMore: boolean; nextCursor: string | null; range: JongnoEventRange | null;
}
export interface JongnoEventQuery {
  range: JongnoEventRange | null; category?: JongnoCategory; area?: JongnoArea;
  status?: JongnoStatus; cursor?: string; limit: number;
}
export class JongnoValidationError extends Error {}
function invalid(message: string): never { throw new JongnoValidationError(message); }

export function isJongnoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (Number(value.slice(0, 4)) < 1900 || Number(value.slice(0, 4)) > 2199) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function jongnoToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function eventOccursOn(event: Pick<JongnoEventInput, 'startDate' | 'endDate' | 'excludedWeekdays' | 'excludedDates'>, date: string): boolean {
  return isJongnoDate(date) && date >= event.startDate && date <= event.endDate
    && !event.excludedDates.includes(date)
    && !event.excludedWeekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}
export function eventHasOccurrenceInRange(event: Pick<JongnoEventInput, 'startDate' | 'endDate' | 'excludedWeekdays' | 'excludedDates'>, from: string, to: string): boolean {
  if (!isJongnoDate(from) || !isJongnoDate(to) || from > to) return false;
  const first = event.startDate > from ? event.startDate : from;
  const last = event.endDate < to ? event.endDate : to;
  if (first > last || event.excludedWeekdays.length === 7) return false;
  // A valid event can exclude at most 100 individual dates. Every 7-day span has
  // an open weekday, so inspecting the first 707 days also bounds large events.
  let date = new Date(`${first}T00:00:00Z`);
  for (let i = 0; i < 707 && date.toISOString().slice(0, 10) <= last; i++) {
    if (eventOccursOn(event, date.toISOString().slice(0, 10))) return true;
    date = new Date(date.getTime() + 86400000);
  }
  return false;
}

function textField(body: Record<string, unknown>, key: string, max: number, required = false): string {
  const raw = body[key];
  if (raw === undefined || raw === null) { if (required) invalid(`${key}을(를) 입력해주세요.`); return ''; }
  if (typeof raw !== 'string') invalid(`${key}은(는) 문자열이어야 합니다.`);
  const value = (raw as string).trim();
  if ((required && !value) || value.length > max) invalid(`${key}은(는) ${required ? '1~' : '최대 '}${max}자까지 입력할 수 있습니다.`);
  return value;
}
export function safeJongnoUrl(raw: string, required = false): string {
  if (!raw) { if (required) invalid('공개하려면 공식 안내 링크가 필요합니다.'); return ''; }
  if (raw.length > 2000 || /[\r\n\u0000-\u001f\u007f]/.test(raw)) invalid('링크 형식을 확인해주세요.');
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalid('http 또는 https 링크만 사용할 수 있습니다.');
    return url.href;
  } catch { return invalid('올바른 http 또는 https 링크를 입력해주세요.'); }
}
function enumValue<T extends readonly string[]>(value: unknown, choices: T, label: string, fallback?: T[number]): T[number] {
  if (value === undefined && fallback) return fallback;
  if (typeof value !== 'string' || !choices.includes(value)) invalid(`${label}을(를) 확인해주세요.`);
  return value as T[number];
}
export function parseJongnoEventInput(raw: unknown): JongnoEventInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('행사 내용을 확인해주세요.');
  const body = raw as Record<string, unknown>;
  const startDate = textField(body, 'startDate', 10, true), endDate = textField(body, 'endDate', 10, true);
  if (!isJongnoDate(startDate) || !isJongnoDate(endDate)) invalid('행사 날짜를 YYYY-MM-DD 형식으로 입력해주세요.');
  if (startDate > endDate) invalid('종료일은 시작일 이후여야 합니다.');
  const weekdays = body.excludedWeekdays ?? [];
  if (!Array.isArray(weekdays) || weekdays.length > 7 || weekdays.some(value => !Number.isInteger(value) || value < 0 || value > 6)) invalid('휴관 요일을 확인해주세요.');
  const exclusions = body.excludedDates ?? [];
  if (!Array.isArray(exclusions) || exclusions.length > 100 || exclusions.some(value => !isJongnoDate(value) || value < startDate || value > endDate)) invalid('휴관일은 행사 기간 안의 날짜로 최대 100개 입력할 수 있습니다.');
  if (body.bookingRequired !== undefined && typeof body.bookingRequired !== 'boolean') invalid('예약 필요 여부를 확인해주세요.');
  const images = body.images ?? [];
  if (!Array.isArray(images) || images.length > 6) invalid('사진은 최대 6장까지 등록할 수 있습니다.');
  const normalizedImages: JongnoEventImage[] = images.map(image => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) return invalid('사진 정보를 확인해주세요.');
    const value = image as Record<string, unknown>;
    return { url: safeJongnoUrl(textField(value, 'url', 2000, true), true), alt: textField(value, 'alt', 200), credit: textField(value, 'credit', 200), sourceUrl: safeJongnoUrl(textField(value, 'sourceUrl', 2000)) };
  });
  if (new Set(normalizedImages.map(image => image.url)).size !== normalizedImages.length) invalid('중복된 사진을 제거해주세요.');
  const status = enumValue(body.status, JONGNO_STATUSES, '공개 상태', 'draft');
  let verifiedAt: string | null = null;
  if (body.verifiedAt !== undefined && body.verifiedAt !== null && body.verifiedAt !== '') {
    if (typeof body.verifiedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(body.verifiedAt) || !isJongnoDate((body.verifiedAt as string).slice(0, 10))) invalid('공식 일정 확인일을 확인해주세요.');
    const confirmed = new Date(body.verifiedAt as string);
    if (!Number.isFinite(confirmed.getTime()) || confirmed.getTime() > Date.now() + 5 * 60 * 1000) invalid('공식 일정 확인일은 미래로 지정할 수 없습니다.');
    verifiedAt = confirmed.toISOString();
  }
  if (status === 'published' && !verifiedAt) invalid('공개하기 전에 공식 일정을 확인하고 확인 버튼을 눌러주세요.');
  const result: JongnoEventInput = {
    titleKo: textField(body, 'titleKo', 200, true), titleEn: textField(body, 'titleEn', 200),
    descriptionKo: textField(body, 'descriptionKo', 10000), descriptionEn: textField(body, 'descriptionEn', 10000),
    category: enumValue(body.category, JONGNO_CATEGORIES, '행사 종류'), area: enumValue(body.area, JONGNO_AREAS, '지역'),
    venue: textField(body, 'venue', 200), address: textField(body, 'address', 500), startDate, endDate,
    timeText: textField(body, 'timeText', 500), excludedWeekdays: [...new Set(weekdays)].sort((a, b) => a - b), excludedDates: [...new Set(exclusions)].sort(),
    feeType: enumValue(body.feeType, JONGNO_FEE_TYPES, '요금 종류', 'unknown'), feeText: textField(body, 'feeText', 500),
    bookingRequired: body.bookingRequired === true,
    officialUrl: safeJongnoUrl(textField(body, 'officialUrl', 2000), status === 'published'),
    bookingUrl: safeJongnoUrl(textField(body, 'bookingUrl', 2000)), mapUrl: safeJongnoUrl(textField(body, 'mapUrl', 2000)),
    languageText: textField(body, 'languageText', 300), images: normalizedImages, status, verifiedAt,
  };
  if (status === 'published' && !eventHasOccurrenceInRange(result, startDate, endDate)) invalid('진행 날짜가 없는 행사는 공개할 수 없습니다. 휴관일을 확인해주세요.');
  return result;
}
export function parseJongnoVersion(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || (raw as number) < 1) return invalid('저장 버전이 올바르지 않습니다. 목록을 새로 불러와주세요.');
  return raw as number;
}
export function parseJongnoEventQuery(params: URLSearchParams, publicOnly: boolean, now = new Date()): JongnoEventQuery {
  let range: JongnoEventRange | null = null;
  const month = params.get('month'), from = params.get('from'), to = params.get('to');
  if (month !== null && (from !== null || to !== null)) invalid('월 또는 시작·종료 날짜 중 하나만 선택해주세요.');
  if (month !== null || (publicOnly && from === null && to === null)) {
    const value = month ?? jongnoToday(now).slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || !isJongnoDate(`${value}-01`)) invalid('월을 YYYY-MM 형식으로 입력해주세요.');
    const first = `${value}-01`, end = new Date(`${first}T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
    range = { from: first, to: end.toISOString().slice(0, 10) };
  } else if (from !== null || to !== null) {
    if (!isJongnoDate(from) || !isJongnoDate(to) || from > to) invalid('조회 기간을 확인해주세요.');
    if ((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000 >= 93) invalid('한 번에 최대 93일을 조회할 수 있습니다.');
    range = { from, to };
  }
  const rawLimit = params.get('limit'), limit = rawLimit === null ? (publicOnly ? 100 : 30) : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > (publicOnly ? 100 : 50)) invalid('조회 개수를 확인해주세요.');
  const cursor = params.get('cursor');
  if (cursor !== null && !/^[\w-]{1,100}$/.test(cursor)) invalid('다음 목록 위치를 확인해주세요.');
  const category = params.get('category'), area = params.get('area'), status = params.get('status');
  return { range, limit, ...(cursor ? { cursor } : {}),
    ...(category ? { category: enumValue(category, JONGNO_CATEGORIES, '행사 종류') } : {}),
    ...(area ? { area: enumValue(area, JONGNO_AREAS, '지역') } : {}),
    ...(!publicOnly && status ? { status: enumValue(status, JONGNO_STATUSES, '공개 상태') } : {}),
  };
}
