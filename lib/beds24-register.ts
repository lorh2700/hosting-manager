/**
 * "Beds24 에 먼저 만들고, 확인된 뒤에만 플랫폼에 저장" 파이프라인의 공통 부분.
 * 직접 예약 등록(/api/beds24/reservations)과 객실정비 차단(/api/beds24/maintenance)이 함께 쓴다.
 *
 *   1. 사전 조회  — 같은 객실·날짜·이름의 활성 항목이 이미 있으면 재사용 (재시도 중복 방지)
 *   2. 생성      — POST /bookings. 토큰/429/5xx 는 재시도, 응답 유실(네트워크)은 조회로 복구
 *   3. 최종 확인 — GET /bookings?id= 로 존재·상태·객실·날짜 검증
 *
 * 플랫폼 저장(Event upsert)은 호출자가 한다 — 저장할 내용이 예약/정비마다 다르기 때문.
 */
import {
  beds24Put,
  beds24WithRetry,
  describeBeds24Error,
  isBeds24TransientError,
  Beds24NetworkError,
} from '@/lib/beds24';
import {
  createBeds24Booking,
  findMatchingBeds24Booking,
  verifyBeds24Booking,
  Beds24BookingRejectedError,
  Beds24UnexpectedResponseError,
  type Beds24Booking,
  type Beds24BookingKind,
  type BookingVerification,
} from '@/lib/beds24-booking';

// Netlify 함수 타임아웃(26s) 안에서 사전조회 → 생성 → 최종확인 → 저장까지 끝내기 위한 예산.
export const ROUTE_BUDGET_MS = 22_000;
const MAX_CREATE_ATTEMPTS = 2;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type RegisterOrigin = 'created' | 'reused' | 'recovered' | 'provided';

export interface RegisterInput {
  kind: Beds24BookingKind;
  roomId: number;
  arrival: string;
  departure: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  numAdult?: number;
  numChild?: number;
  notes?: string;
  /** 이전 시도에서 Beds24 등록까지는 됐지만 확인/저장에 실패한 경우의 booking id. */
  providedBookingId?: unknown;
  deadlineAt: number;
  /** 로그 접두어, 예: '[beds24/reservations]' */
  logPrefix: string;
}

export type RegisterOutcome =
  | { ok: true; bookingId: number; origin: RegisterOrigin; booking: Beds24Booking }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Beds24 에 항목을 만들고(또는 기존 항목을 찾아) 최종 확인까지 마친다.
 * 실패 시 { status, body } 는 그대로 NextResponse.json(body, { status }) 로 돌려주면 된다.
 * body.pendingBeds24BookingId 가 있으면 Beds24 에는 있고 플랫폼에는 없는 상태다.
 */
export async function registerBeds24BookingVerified(input: RegisterInput): Promise<RegisterOutcome> {
  const { kind, roomId, arrival, departure, firstName, lastName, deadlineAt, logPrefix } = input;
  const noun = kind === 'block' ? '정비 차단' : '예약';
  const log = (msg: string, extra?: unknown) =>
    extra === undefined ? console.log(`${logPrefix} ${msg}`) : console.log(`${logPrefix} ${msg}`, extra);

  const identity = { roomId, arrival, departure, firstName, lastName, kind };
  const expected = { roomId, arrival, departure, kind };

  let bookingId: number | null = null;
  let origin: RegisterOrigin = 'created';

  const raw = input.providedBookingId;
  const hasProvidedId = raw !== undefined && raw !== null && String(raw).trim() !== '';

  if (hasProvidedId) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, status: 400, body: { error: 'beds24BookingId 형식이 올바르지 않습니다.', clearPending: true } };
    }
    bookingId = n;
    origin = 'provided';
    log(`re-verifying previously created Beds24 booking #${n}`);
  } else {
    // ── 1) 사전 조회 (best-effort) ──
    try {
      const existing = await beds24WithRetry(
        'pre-check',
        () => findMatchingBeds24Booking(identity, { timeoutMs: 8_000 }),
        { attempts: 2, baseDelayMs: 800, deadlineAt },
      );
      if (existing) {
        bookingId = existing.id;
        origin = 'reused';
        log(`reusing existing Beds24 booking #${existing.id}`, identity);
      }
    } catch (e) {
      log(`pre-check failed, proceeding to create: ${describeBeds24Error(e)}`);
    }

    // ── 2) 생성 ──
    let lastCreateErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS && bookingId === null; attempt++) {
      try {
        const created = await createBeds24Booking({
          roomId, arrival, departure, firstName, lastName,
          email: input.email ?? '',
          phone: input.phone ?? '',
          numAdult: input.numAdult ?? 1,
          numChild: input.numChild ?? 0,
          notes: input.notes ?? '',
          status: kind === 'block' ? 'black' : 'confirmed',
        }, { timeoutMs: 12_000 });
        bookingId = created.id;
        origin = 'created';
        log(`created Beds24 booking #${created.id} (attempt ${attempt})`);
      } catch (e) {
        lastCreateErr = e;

        if (e instanceof Beds24BookingRejectedError) {
          log(`Beds24 rejected: ${e.message}`);
          return { ok: false, status: 422, body: { error: `Beds24가 ${noun}을 거부했습니다: ${e.message}`, stage: 'create' } };
        }

        // 5xx/429/토큰 오류는 요청이 처리되지 않은 것이므로 바로 재시도해도 안전.
        let safeToRetry = isBeds24TransientError(e);

        if (e instanceof Beds24NetworkError || e instanceof Beds24UnexpectedResponseError) {
          // 요청이 Beds24 에 도달해 생성됐을 가능성 → 조회로 확인한 뒤에만 재시도.
          safeToRetry = false;
          try {
            const found = await findMatchingBeds24Booking(identity, { timeoutMs: 8_000 });
            if (found) {
              bookingId = found.id;
              origin = 'recovered';
              log(`recovered Beds24 booking #${found.id} after ${e.name}`);
              break;
            }
            safeToRetry = true; // 생성되지 않았음이 확인됨
          } catch (lookupErr) {
            log(`recovery lookup failed after ${e.name}: ${describeBeds24Error(lookupErr)}`);
          }
        }

        if (!safeToRetry || attempt >= MAX_CREATE_ATTEMPTS || Date.now() + 5_000 > deadlineAt) break;
        log(`create attempt ${attempt} failed, retrying: ${describeBeds24Error(e)}`);
        await sleep(1_500);
      }
    }

    if (bookingId === null) {
      console.error(`${logPrefix} Beds24 creation failed:`, lastCreateErr);
      return {
        ok: false,
        status: 502,
        body: {
          error: `Beds24에 ${noun}을 등록하지 못했습니다 (${describeBeds24Error(lastCreateErr)}). 플랫폼에는 아무것도 저장되지 않았습니다. 잠시 후 다시 시도해주세요. 같은 항목이 Beds24에 이미 생성돼 있으면 중복 없이 이어서 등록됩니다.`,
          stage: 'create',
        },
      };
    }
  }

  // ── 3) 최종 확인 ──
  let verification: BookingVerification;
  try {
    verification = await verifyBeds24Booking(bookingId, expected, {
      deadlineAt,
      attempts: 3,
      notFoundRetries: origin === 'created' ? 1 : 0,
    });
  } catch (e) {
    console.error(`${logPrefix} verification of Beds24 booking #${bookingId} inconclusive:`, e);
    return {
      ok: false,
      status: 502,
      body: {
        error: `Beds24 ${noun}(#${bookingId})은 생성되었지만 최종 확인 통신에 실패했습니다 (${describeBeds24Error(e)}). 플랫폼에는 아직 등록되지 않았습니다. 잠시 후 'Beds24 확인 후 등록'을 눌러주세요.`,
        stage: 'verify',
        pendingBeds24BookingId: String(bookingId),
      },
    };
  }

  if (!verification.ok) {
    log(`verification of Beds24 booking #${bookingId} failed (${verification.reason}): ${verification.detail}`, verification.booking);
    const message = origin === 'provided'
      ? `Beds24 ${noun}(#${bookingId})을 확인할 수 없습니다: ${verification.detail} 처음부터 다시 등록해주세요.`
      : `Beds24 ${noun}(#${bookingId}) 생성 후 확인 결과가 일치하지 않습니다: ${verification.detail} Beds24에서 직접 확인해주세요. 플랫폼에는 등록되지 않았습니다.`;
    return {
      ok: false,
      status: 409,
      body: { error: message, stage: 'verify', clearPending: true, verification: { reason: verification.reason, detail: verification.detail } },
    };
  }

  return { ok: true, bookingId, origin, booking: verification.booking };
}

/** Beds24 항목 취소 (예약·차단 공통). PUT status=cancelled 는 멱등이라 일시 오류에 재시도해도 안전. */
export async function cancelBeds24Booking(bookingId: string | number): Promise<void> {
  await beds24WithRetry(
    `cancel booking #${bookingId}`,
    () => beds24Put('/bookings', [{ id: Number(bookingId), status: 'cancelled' }]),
    { attempts: 2, baseDelayMs: 1000 },
  );
}
