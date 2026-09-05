import { prisma } from '@/lib/prisma';

const BEDS24_REFRESH_TOKEN = process.env.BEDS24_REFRESH_TOKEN;
const BEDS24_BASE_URL = 'https://beds24.com/api/v2';

const TOKEN_CACHE_ID = 'singleton';
const SAFETY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry
const TOKEN_FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;

let memoryToken: string | null = null;
let memoryExpiresAt = 0;
// 동시에 여러 요청이 refresh 를 치지 않도록 진행 중인 refresh 를 공유한다.
let refreshInFlight: Promise<{ token: string; expiresAt: number }> | null = null;

// ── 오류 분류 ──────────────────────────────────────────────────────────────
// 호출자가 "잠시 후 다시 시도해도 되는 오류"(일시적)와 "Beds24 가 명시적으로
// 거부한 오류"를 구분할 수 있도록 오류 타입을 나눈다. 예약 생성처럼 부작용이
// 있는 호출에서는 요청이 Beds24 에 도달했는지 여부(NetworkError)까지 구분해야
// 중복 생성 없이 안전하게 재시도할 수 있다.

/** Beds24 가 HTTP 오류 상태로 응답한 경우. */
export class Beds24ApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly method: string;
  readonly path: string;
  constructor(method: string, path: string, status: number, body: string) {
    super(`Beds24 ${method} ${path} failed: ${status} ${body}`);
    this.name = 'Beds24ApiError';
    this.status = status;
    this.body = body;
    this.method = method;
    this.path = path;
  }
  /** 429/408/5xx — 요청이 처리되지 않았고, 잠시 후 재시도하면 성공할 가능성이 있는 응답. */
  get isTransient(): boolean {
    return this.status === 429 || this.status === 408 || this.status >= 500;
  }
}

/**
 * 요청이 Beds24 에 도달했는지 알 수 없는 오류 (DNS/TCP 실패, 타임아웃).
 * 부작용이 있는 호출(POST)은 재시도 전에 실제 생성 여부를 조회로 확인해야 한다.
 */
export class Beds24NetworkError extends Error {
  readonly method: string;
  readonly path: string;
  readonly timedOut: boolean;
  constructor(method: string, path: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`Beds24 ${method} ${path} network error: ${causeMsg}`);
    this.name = 'Beds24NetworkError';
    this.method = method;
    this.path = path;
    this.timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
  }
}

/** 액세스 토큰 발급/갱신 실패. transient 이면 재시도 가치가 있다. */
export class Beds24TokenError extends Error {
  readonly transient: boolean;
  constructor(message: string, transient: boolean) {
    super(message);
    this.name = 'Beds24TokenError';
    this.transient = transient;
  }
}

export function isBeds24TransientError(err: unknown): boolean {
  if (err instanceof Beds24ApiError) return err.isTransient;
  if (err instanceof Beds24NetworkError) return true;
  if (err instanceof Beds24TokenError) return err.transient;
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
    return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(err.message);
  }
  return false;
}

/** 사용자에게 보여줄 수 있는 짧은 한국어 설명. */
export function describeBeds24Error(err: unknown): string {
  if (err instanceof Beds24TokenError) return `Beds24 인증 토큰 오류: ${err.message}`;
  if (err instanceof Beds24NetworkError) return err.timedOut ? 'Beds24 응답 시간 초과' : `Beds24 통신 오류: ${err.message}`;
  if (err instanceof Beds24ApiError) {
    const body = err.body ? ` ${err.body.slice(0, 200)}` : '';
    return `Beds24 API 오류 ${err.status}${body}`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ── 토큰 관리 ──────────────────────────────────────────────────────────────

async function readDbToken(): Promise<{ token: string; expiresAt: number } | null> {
  try {
    const row = await prisma.beds24TokenCache.findUnique({ where: { id: TOKEN_CACHE_ID } });
    if (!row) return null;
    return { token: row.token, expiresAt: row.expiresAt.getTime() };
  } catch (e) {
    console.warn('[beds24] readDbToken failed:', e);
    return null;
  }
}

async function writeDbToken(token: string, expiresAt: number): Promise<void> {
  try {
    await prisma.beds24TokenCache.upsert({
      where: { id: TOKEN_CACHE_ID },
      create: { id: TOKEN_CACHE_ID, token, expiresAt: new Date(expiresAt) },
      update: { token, expiresAt: new Date(expiresAt) },
    });
  } catch (e) {
    console.warn('[beds24] writeDbToken failed:', e);
  }
}

async function requestNewToken(): Promise<{ token: string; expiresAt: number }> {
  if (!BEDS24_REFRESH_TOKEN) throw new Beds24TokenError('BEDS24_REFRESH_TOKEN is not configured', false);

  let res: Response;
  try {
    res = await fetch(`${BEDS24_BASE_URL}/authentication/token`, {
      headers: { refreshToken: BEDS24_REFRESH_TOKEN },
      signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Beds24TokenError(
      `Beds24 token refresh network error: ${e instanceof Error ? e.message : String(e)}`,
      true,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const transient = res.status === 429 || res.status === 408 || res.status >= 500;
    throw new Beds24TokenError(`Beds24 token refresh failed: ${res.status} ${text.slice(0, 200)}`.trim(), transient);
  }

  const data = await res.json().catch(() => null);
  if (!data?.token) throw new Beds24TokenError('No token in Beds24 response', false);

  // Beds24 returns expiresIn in seconds (token typically valid 24h).
  const expiresInSec = typeof data.expiresIn === 'number' ? data.expiresIn : 3600;
  const expiresAt = Date.now() + expiresInSec * 1000;

  await writeDbToken(data.token, expiresAt);
  return { token: data.token, expiresAt };
}

/**
 * 토큰 갱신. 일시 오류면 짧게 재시도하고, 그래도 실패하면 아직 유효한 DB 캐시
 * 토큰으로 폴백한다 (곧 만료될 토큰이라도 요청을 실패시키는 것보단 낫다).
 * `rejectedToken` 은 방금 401 을 받은 토큰 — 폴백 후보에서 제외.
 */
async function refreshToken(rejectedToken?: string): Promise<{ token: string; expiresAt: number }> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await requestNewToken();
      } catch (e) {
        lastErr = e;
        const transient = e instanceof Beds24TokenError && e.transient;
        console.warn(`[beds24] token refresh attempt ${attempt} failed:`, e instanceof Error ? e.message : e);
        if (!transient) break;
        if (attempt < 2) await sleep(800);
      }
    }

    const cached = await readDbToken();
    if (cached && cached.expiresAt > Date.now() && cached.token !== rejectedToken) {
      console.warn('[beds24] token refresh failed; falling back to DB-cached token', {
        expiresAt: new Date(cached.expiresAt).toISOString(),
      });
      return cached;
    }
    throw lastErr instanceof Error ? lastErr : new Beds24TokenError(String(lastErr), false);
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export async function getBeds24Token(forceRefresh = false): Promise<string> {
  const now = Date.now();
  const rejected = forceRefresh ? (memoryToken ?? undefined) : undefined;

  if (forceRefresh) {
    memoryToken = null;
    memoryExpiresAt = 0;
  } else {
    // 1) Warm path — in-memory cache
    if (memoryToken && now < memoryExpiresAt - SAFETY_BUFFER_MS) {
      return memoryToken;
    }

    // 2) DB-backed cache (survives cold starts)
    const dbCached = await readDbToken();
    if (dbCached && now < dbCached.expiresAt - SAFETY_BUFFER_MS) {
      memoryToken = dbCached.token;
      memoryExpiresAt = dbCached.expiresAt;
      return dbCached.token;
    }
  }

  // 3) Refresh from Beds24
  const fresh = await refreshToken(rejected);
  memoryToken = fresh.token;
  memoryExpiresAt = fresh.expiresAt;
  return fresh.token;
}

/** 401 등으로 토큰이 무효해졌을 때 메모리 캐시를 비운다. */
export function invalidateBeds24Token(): void {
  memoryToken = null;
  memoryExpiresAt = 0;
}

// ── HTTP 호출 ──────────────────────────────────────────────────────────────

// Beds24 v2 의 5-분 credit pool 헤더 파싱.
// 실제 헤더 이름: x-five-min-limit-remaining / x-five-min-limit-resets-in / x-request-cost
// (예전 코드는 x-fivemincredit* 를 읽어 한 번도 값을 얻지 못했다. 구 이름은 호환용으로만 남김)
// 계정 기본 한도는 5분당 100크레딧, 호출 1건이 보통 1크레딧.
export interface Beds24CreditInfo {
  remaining: number | null;
  resetInSec: number | null;
  limit: number | null;
  cost: number | null;
  observedAt: number;
}

let lastCreditInfo: Beds24CreditInfo | null = null;

/** 가장 최근 응답에서 읽은 크레딧 상태 (진단·연동 현황 표시용). */
export function getLastBeds24CreditInfo(): Beds24CreditInfo | null {
  return lastCreditInfo;
}

function parseCreditHeaders(res: Response): Beds24CreditInfo {
  const num = (names: string[]): number | null => {
    for (const n of names) {
      const v = res.headers.get(n);
      if (v === null || v === '') continue;
      const x = Number(v);
      if (Number.isFinite(x)) return x;
    }
    return null;
  };
  const info: Beds24CreditInfo = {
    remaining: num(['x-five-min-limit-remaining', 'x-fivemincreditremaining']),
    resetInSec: num(['x-five-min-limit-resets-in', 'x-fivemincreditresetin']),
    limit: num(['x-five-min-limit', 'x-fivemincreditlimit']),
    cost: num(['x-request-cost']),
    observedAt: Date.now(),
  };
  if (info.remaining !== null || info.resetInSec !== null) lastCreditInfo = info;
  return info;
}

// 응답 헤더의 credit remaining 이 임계치 아래로 떨어지면 경고 로그.
function logCreditIfLow(path: string, headers: Beds24CreditInfo) {
  if (headers.remaining !== null && headers.remaining < 20) {
    console.warn('[beds24] credit pool low', { path, remaining: headers.remaining, resetInSec: headers.resetInSec, cost: headers.cost });
  }
}

// 429 뒤 기다렸다 재시도할 최대 시간. 리셋까지 이보다 길면 Netlify 함수 시간(26s) 안에
// 성공할 수 없으므로 바로 오류로 넘긴다 (호출자는 다음 크론에서 다시 시도한다).
const MAX_429_WAIT_SEC = 12;

function stripQuery(path: string) {
  return path.split('?')[0];
}

// 단일 fetch 실행 + 429 시 1회 재시도. 네트워크 실패/타임아웃은 Beds24NetworkError 로 감싼다.
async function fetchBeds24(method: string, path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const url = path.startsWith('http') ? path : `${BEDS24_BASE_URL}${path}`;
  const logPath = stripQuery(path);

  const doFetch = async (): Promise<Response> => {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new Beds24NetworkError(method, logPath, e);
    }
  };

  let res = await doFetch();

  if (res.status === 429) {
    const credit = parseCreditHeaders(res);
    const retryAfter = Number(res.headers.get('retry-after') ?? '');
    // 리셋까지 남은 시간: resets-in 우선, 없으면 Retry-After.
    const waitSec = credit.resetInSec ?? (Number.isFinite(retryAfter) ? retryAfter : null);
    if (waitSec !== null && waitSec <= MAX_429_WAIT_SEC) {
      console.warn('[beds24] 429 credit exhausted — reset is near, waiting once', { path: logPath, waitSec });
      await sleep((Math.max(waitSec, 1) + 1) * 1000);
      res = await doFetch();
    } else {
      // 5분 창이 아직 한참 남았으면 기다려도 의미가 없다 — 즉시 429 오류로 넘긴다.
      console.warn('[beds24] 429 credit exhausted — giving up until window resets', {
        path: logPath, resetInSec: waitSec, limit: credit.limit,
      });
    }
  }

  logCreditIfLow(logPath, parseCreditHeaders(res));
  return res;
}

export interface Beds24RequestOptions {
  /** 개별 HTTP 요청 타임아웃 (기본 12s). */
  timeoutMs?: number;
}

// 토큰 첨부 + 401 이면 토큰 강제 갱신 후 1회 재시도. 그 외 non-2xx 는 Beds24ApiError.
async function beds24Request(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body: unknown,
  opts: Beds24RequestOptions = {},
) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const build = (token: string): RequestInit => ({
    method,
    headers: body === undefined ? { token } : { token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let token = await getBeds24Token();
  let res = await fetchBeds24(method, path, build(token), timeoutMs);

  if (res.status === 401) {
    // 캐시된 토큰이 만료/폐기된 경우 — 강제 갱신 후 1회 재시도.
    // (401 은 요청이 처리되지 않았다는 뜻이므로 POST 도 안전하게 재시도 가능)
    console.warn('[beds24] 401 from API — refreshing token and retrying once', { method, path: stripQuery(path) });
    token = await getBeds24Token(true);
    res = await fetchBeds24(method, path, build(token), timeoutMs);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Beds24ApiError(method, stripQuery(path), res.status, text);
  }
  return res.json();
}

export async function beds24Get(path: string, params?: Record<string, string>, opts?: Beds24RequestOptions) {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  return beds24Request('GET', `${path}${qs}`, undefined, opts);
}

export async function beds24Post(
  path: string,
  body: Record<string, unknown> | Record<string, unknown>[],
  opts?: Beds24RequestOptions,
) {
  return beds24Request('POST', path, body, opts);
}

export async function beds24Put(
  path: string,
  body: Record<string, unknown> | Record<string, unknown>[],
  opts?: Beds24RequestOptions,
) {
  return beds24Request('PUT', path, body, opts);
}

// ── 재시도 헬퍼 ────────────────────────────────────────────────────────────

export interface Beds24RetryOptions {
  /** 총 시도 횟수 (기본 3). */
  attempts?: number;
  /** 첫 재시도 대기 (기본 1000ms), 이후 2배씩 증가. */
  baseDelayMs?: number;
  /** 이 시각(epoch ms) 을 넘길 것 같으면 재시도하지 않고 마지막 오류를 던진다. */
  deadlineAt?: number;
  /** 기본: isBeds24TransientError. 부작용 있는 호출은 더 보수적으로 지정할 것. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

/**
 * 일시 오류(토큰 갱신 실패, 429, 5xx, 네트워크)에 대해 지수 백오프로 재시도한다.
 * 주의: POST 처럼 부작용이 있는 호출에서 네트워크 오류는 "요청이 도달했을 수도"
 * 있으므로 shouldRetry 로 제외하고 호출자가 조회로 확인한 뒤 재시도해야 한다.
 */
export async function beds24WithRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: Beds24RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseDelayMs ?? 1000;
  const shouldRetry = opts.shouldRetry ?? ((e: unknown) => isBeds24TransientError(e));

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === attempts || !shouldRetry(e, attempt)) throw e;
      const delay = base * 2 ** (attempt - 1);
      if (opts.deadlineAt !== undefined && Date.now() + delay + 2000 > opts.deadlineAt) {
        console.warn(`[beds24] ${label}: no time budget left for retry — giving up`, describeBeds24Error(e));
        throw e;
      }
      console.warn(`[beds24] ${label} failed (attempt ${attempt}/${attempts}), retrying in ${delay}ms: ${describeBeds24Error(e)}`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

export { BEDS24_BASE_URL, BEDS24_REFRESH_TOKEN };
