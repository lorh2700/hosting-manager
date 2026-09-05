/**
 * Beds24 예약(booking) 생성·조회·검증 헬퍼.
 *
 * 핵심 원칙: 플랫폼(DB)에 예약을 기록하기 전에 Beds24 에 예약이 실제로
 * 존재하는지 GET 으로 최종 확인한다. POST 응답만 믿으면 토큰 문제·응답 유실·
 * 응답 형식 변경 때문에 "Beds24 에는 있는데 플랫폼에는 없음"(또는 그 반대)
 * 상태가 생길 수 있다.
 */
import { beds24Get, beds24Post, beds24WithRetry, type Beds24RequestOptions } from '@/lib/beds24';

export interface Beds24Booking {
  id: number;
  propertyId?: number;
  roomId?: number;
  status?: string;
  arrival?: string;
  departure?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  numAdult?: number;
  numChild?: number;
  bookingTime?: string;
  modified?: string;
  [key: string]: unknown;
}

export interface CreateBeds24BookingInput {
  /** roomId 가 있으면 roomId 로, 없으면 propertyId 로 생성. */
  roomId?: number;
  propertyId?: number;
  arrival: string;   // YYYY-MM-DD
  departure: string; // YYYY-MM-DD
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  numAdult: number;
  numChild: number;
  notes?: string;
  status?: string;
}

/** Beds24 가 요청을 받았지만 명시적으로 거부한 경우 (검증 오류 등). 재시도해도 같은 결과. */
export class Beds24BookingRejectedError extends Error {
  readonly details: string[];
  constructor(details: string[]) {
    super(details.length ? details.join('; ') : 'Beds24 rejected the booking');
    this.name = 'Beds24BookingRejectedError';
    this.details = details;
  }
}

/** 2xx 응답은 왔지만 booking id 를 찾을 수 없는 경우 — 실제 생성 여부를 조회로 확인해야 한다. */
export class Beds24UnexpectedResponseError extends Error {
  readonly raw: string;
  constructor(raw: unknown) {
    const text = (() => {
      try { return JSON.stringify(raw); } catch { return String(raw); }
    })().slice(0, 500);
    super(`Beds24 returned an unexpected booking response: ${text}`);
    this.name = 'Beds24UnexpectedResponseError';
    this.raw = text;
  }
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const day = (v: unknown) => String(v ?? '').slice(0, 10);

/** 'reservation' = 확정 예약(confirmed), 'block' = 날짜 차단(black). */
export type Beds24BookingKind = 'reservation' | 'block';

// ── 객실정비(유지보수 차단) 규약 ──
// Beds24 블랙아웃(black) 중 메모가 이 접두어로 시작하면 "객실정비"로 분류한다.
// 호스팅 매니저에서 만들든 Beds24 화면에서 직접 만들든 같은 규칙이 적용된다.
export const MAINTENANCE_NOTE_PREFIX = '객실정비';
export const MAINTENANCE_TITLE = '객실정비';

export function isMaintenanceNotes(notes: unknown): boolean {
  return String(notes ?? '').trim().startsWith(MAINTENANCE_NOTE_PREFIX);
}

export function buildMaintenanceNotes(reason: string): string {
  const r = reason.trim();
  return r ? `${MAINTENANCE_NOTE_PREFIX}: ${r}` : MAINTENANCE_NOTE_PREFIX;
}

export function maintenanceReasonFromNotes(notes: unknown): string {
  return String(notes ?? '').trim().replace(/^객실정비\s*[:：-]?\s*/, '').trim();
}

export function isCancelledStatus(status: unknown): boolean {
  const s = norm(status);
  return s === 'cancelled' || s === 'canceled';
}

/** Beds24 의 'black' 은 예약이 아니라 날짜 차단. */
export function isBlockStatus(status: unknown): boolean {
  return norm(status) === 'black';
}

function extractErrorMessages(item: Record<string, unknown>): string[] {
  const out: string[] = [];
  const errors = item.errors;
  if (Array.isArray(errors)) {
    for (const e of errors) {
      if (typeof e === 'string') {
        out.push(e);
      } else if (e && typeof e === 'object') {
        const o = e as Record<string, unknown>;
        const field = o.field ? `${String(o.field)}: ` : '';
        const msg = o.message ?? o.error ?? JSON.stringify(o);
        out.push(`${field}${String(msg)}`);
      }
    }
  }
  if (typeof item.error === 'string') out.push(item.error);
  if (out.length === 0 && typeof item.message === 'string') out.push(item.message);
  return out;
}

/**
 * POST /bookings 로 예약 1건 생성. Beds24 응답 형식:
 *   [{ success: true, new: { id, ... } }]  또는  [{ success: false, errors: [...] }]
 * (구형/변형 응답의 id, bookingId 도 허용)
 */
export async function createBeds24Booking(
  input: CreateBeds24BookingInput,
  opts?: Beds24RequestOptions,
): Promise<{ id: number; booking: Beds24Booking | null; raw: unknown }> {
  const payload: Record<string, unknown> = {
    arrival: input.arrival,
    departure: input.departure,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email ?? '',
    phone: input.phone ?? '',
    numAdult: input.numAdult,
    numChild: input.numChild,
    status: input.status ?? 'confirmed',
    notes: input.notes ?? '',
  };
  if (input.roomId) payload.roomId = input.roomId;
  else if (input.propertyId) payload.propertyId = input.propertyId;

  const raw = await beds24Post('/bookings', [payload], opts);
  const item = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
  if (!item || typeof item !== 'object') throw new Beds24UnexpectedResponseError(raw);
  if (item.success === false) throw new Beds24BookingRejectedError(extractErrorMessages(item));

  const created = (item.new && typeof item.new === 'object' ? item.new : null) as Beds24Booking | null;
  const id = Number(created?.id ?? item.id ?? item.bookingId);
  if (!Number.isFinite(id) || id <= 0) throw new Beds24UnexpectedResponseError(raw);

  return { id, booking: created, raw };
}

/** GET /bookings?id=… — 없으면 null (일시 오류는 throw). */
export async function fetchBeds24BookingById(
  id: number | string,
  opts?: Beds24RequestOptions,
): Promise<Beds24Booking | null> {
  const data = await beds24Get('/bookings', { id: String(id) }, opts);
  const list = Array.isArray(data?.data) ? (data.data as Beds24Booking[]) : [];
  return list.find((b) => String(b.id) === String(id)) ?? null;
}

export interface BookingMatchCriteria {
  roomId?: number | string;
  propertyId?: number | string;
  arrival: string;
  departure: string;
  firstName: string;
  lastName: string;
  /** 기본 'reservation'. 'block' 이면 차단(black)만 매칭한다. */
  kind?: Beds24BookingKind;
}

/**
 * 같은 객실(또는 숙소)·같은 도착/출발일·같은 이름의 활성 예약을 찾는다.
 * 이전 시도의 응답이 유실됐거나 사용자가 다시 시도할 때 중복 생성을 막는 용도.
 * 여러 건이면 가장 최근에 생성된 것.
 */
export async function findMatchingBeds24Booking(
  c: BookingMatchCriteria,
  opts?: Beds24RequestOptions,
): Promise<Beds24Booking | null> {
  const params: Record<string, string> = { arrivalFrom: c.arrival, arrivalTo: c.arrival };
  if (c.roomId) params.roomId = String(c.roomId);
  else if (c.propertyId) params.propertyId = String(c.propertyId);

  const data = await beds24Get('/bookings', params, opts);
  const list = Array.isArray(data?.data) ? (data.data as Beds24Booking[]) : [];
  const wanted = norm(`${c.firstName} ${c.lastName}`);

  const wantBlock = c.kind === 'block';

  const matches = list.filter((b) =>
    (!c.roomId || String(b.roomId) === String(c.roomId)) &&
    (c.roomId || !c.propertyId || String(b.propertyId) === String(c.propertyId)) &&
    day(b.arrival) === c.arrival &&
    day(b.departure) === c.departure &&
    !isCancelledStatus(b.status) &&
    isBlockStatus(b.status) === wantBlock &&
    norm(`${b.firstName ?? ''} ${b.lastName ?? ''}`) === wanted,
  );
  matches.sort((a, b) => String(b.bookingTime ?? '').localeCompare(String(a.bookingTime ?? '')));
  return matches[0] ?? null;
}

export interface BookingExpectation {
  roomId?: number | string;
  propertyId?: number | string;
  arrival: string;
  departure: string;
  /** 기본 'reservation'. 'block' 이면 상태가 black 이어야 통과한다. */
  kind?: Beds24BookingKind;
}

export type BookingVerification =
  | { ok: true; booking: Beds24Booking }
  | { ok: false; reason: 'not-found' | 'cancelled' | 'mismatch'; booking: Beds24Booking | null; detail: string };

export function checkBeds24BookingMatches(
  booking: Beds24Booking | null,
  expected: BookingExpectation,
): BookingVerification {
  if (!booking) {
    return { ok: false, reason: 'not-found', booking: null, detail: 'Beds24에서 해당 예약을 찾을 수 없습니다.' };
  }
  if (isCancelledStatus(booking.status)) {
    return { ok: false, reason: 'cancelled', booking, detail: `Beds24 예약 상태가 '${booking.status}' 입니다.` };
  }
  if (expected.kind === 'block') {
    if (!isBlockStatus(booking.status)) {
      return { ok: false, reason: 'mismatch', booking, detail: `Beds24 항목이 차단(black)이 아니라 '${booking.status}' 상태입니다.` };
    }
  } else if (isBlockStatus(booking.status)) {
    return { ok: false, reason: 'mismatch', booking, detail: 'Beds24 항목이 예약이 아닌 차단(black)입니다.' };
  }
  if (expected.roomId && String(booking.roomId) !== String(expected.roomId)) {
    return {
      ok: false, reason: 'mismatch', booking,
      detail: `객실이 다릅니다 (Beds24 roomId ${booking.roomId}, 요청 ${expected.roomId}).`,
    };
  }
  if (!expected.roomId && expected.propertyId && String(booking.propertyId) !== String(expected.propertyId)) {
    return {
      ok: false, reason: 'mismatch', booking,
      detail: `숙소가 다릅니다 (Beds24 propertyId ${booking.propertyId}, 요청 ${expected.propertyId}).`,
    };
  }
  if (day(booking.arrival) !== expected.arrival || day(booking.departure) !== expected.departure) {
    return {
      ok: false, reason: 'mismatch', booking,
      detail: `날짜가 다릅니다 (Beds24 ${day(booking.arrival)}~${day(booking.departure)}, 요청 ${expected.arrival}~${expected.departure}).`,
    };
  }
  return { ok: true, booking };
}

export interface VerifyOptions {
  deadlineAt?: number;
  /** GET 일시 오류 재시도 횟수 (기본 3회 시도). */
  attempts?: number;
  /** 방금 생성한 예약이 조회에 반영되기까지의 지연을 흡수하기 위한 not-found 재조회 횟수 (기본 0). */
  notFoundRetries?: number;
}

/**
 * Beds24 에 예약이 실제로 존재하고 기대한 객실/날짜와 일치하는지 최종 확인.
 * - 일시 오류는 재시도하고, 그래도 실패하면 throw (결론 없음 → 호출자가 pending 처리)
 * - 결론이 난 경우 { ok, ... } 로 반환
 */
export async function verifyBeds24Booking(
  id: number | string,
  expected: BookingExpectation,
  opts: VerifyOptions = {},
): Promise<BookingVerification> {
  const notFoundRetries = opts.notFoundRetries ?? 0;
  for (let i = 0; ; i++) {
    const booking = await beds24WithRetry(
      `verify booking #${id}`,
      () => fetchBeds24BookingById(id, { timeoutMs: 8_000 }),
      { attempts: opts.attempts ?? 3, baseDelayMs: 800, deadlineAt: opts.deadlineAt },
    );
    const result = checkBeds24BookingMatches(booking, expected);
    if (result.ok || result.reason !== 'not-found' || i >= notFoundRetries) return result;
    if (opts.deadlineAt !== undefined && Date.now() + 3_500 > opts.deadlineAt) return result;
    await new Promise<void>((r) => setTimeout(r, 1_500));
  }
}
