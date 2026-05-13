import { prisma } from '@/lib/prisma';

const BEDS24_REFRESH_TOKEN = process.env.BEDS24_REFRESH_TOKEN;
const BEDS24_BASE_URL = 'https://beds24.com/api/v2';

const TOKEN_CACHE_ID = 'singleton';
const SAFETY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

let memoryToken: string | null = null;
let memoryExpiresAt = 0;

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

async function refreshToken(): Promise<{ token: string; expiresAt: number }> {
  if (!BEDS24_REFRESH_TOKEN) throw new Error('BEDS24_REFRESH_TOKEN is not configured');

  const res = await fetch(`${BEDS24_BASE_URL}/authentication/token`, {
    headers: { refreshToken: BEDS24_REFRESH_TOKEN },
  });

  if (!res.ok) {
    // On 429 or other transient failure, fall back to whatever cached token
    // we have — even a soon-to-expire one is better than failing the request.
    if (res.status === 429) {
      const cached = await readDbToken();
      if (cached && cached.expiresAt > Date.now()) {
        console.warn('[beds24] token refresh got 429; using DB-cached token');
        return cached;
      }
    }
    throw new Error(`Beds24 token refresh failed: ${res.status}`);
  }

  const data = await res.json();
  if (!data.token) throw new Error('No token in Beds24 response');

  // Beds24 returns expiresIn in seconds (token typically valid 24h).
  const expiresInSec = typeof data.expiresIn === 'number' ? data.expiresIn : 3600;
  const expiresAt = Date.now() + expiresInSec * 1000;

  await writeDbToken(data.token, expiresAt);
  return { token: data.token, expiresAt };
}

export async function getBeds24Token(): Promise<string> {
  const now = Date.now();

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

  // 3) Refresh from Beds24
  const fresh = await refreshToken();
  memoryToken = fresh.token;
  memoryExpiresAt = fresh.expiresAt;
  return fresh.token;
}

// Beds24 v2 의 5-분 credit pool 를 모니터링하기 위한 헤더 파싱.
// 429 발생 시 ResetIn 만큼(또는 Retry-After) 짧게 기다린 후 1회 재시도.
function parseCreditHeaders(res: Response) {
  const remaining = Number(res.headers.get('x-fivemincreditremaining') ?? '');
  const resetIn = Number(res.headers.get('x-fivemincreditresetin') ?? '');
  const limit = Number(res.headers.get('x-fivemincreditlimit') ?? '');
  return {
    remaining: Number.isFinite(remaining) ? remaining : null,
    resetInSec: Number.isFinite(resetIn) ? resetIn : null,
    limit: Number.isFinite(limit) ? limit : null,
  };
}

// 응답 헤더의 credit remaining 이 임계치 아래로 떨어지면 경고 로그.
function logCreditIfLow(path: string, headers: ReturnType<typeof parseCreditHeaders>) {
  if (headers.remaining !== null && headers.remaining < 20) {
    console.warn('[beds24] credit pool low', { path, ...headers });
  }
}

async function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// 단일 fetch 실행 + 429 시 1회 재시도. 외부 호출자는 throw 결과만 신경 쓰면 됨.
async function fetchBeds24(path: string, init: RequestInit): Promise<Response> {
  const url = path.startsWith('http') ? path : `${BEDS24_BASE_URL}${path}`;
  let res = await fetch(url, init);

  if (res.status === 429) {
    const credit = parseCreditHeaders(res);
    const retryAfter = Number(res.headers.get('retry-after') ?? '');
    // ResetIn 우선, 없으면 Retry-After, 둘 다 없으면 10s. 최대 30s 까지만 (Netlify 함수 타임아웃 26s).
    const waitSec = credit.resetInSec ?? (Number.isFinite(retryAfter) ? retryAfter : 10);
    const waitMs = Math.min(Math.max(waitSec, 1), 30) * 1000;
    console.warn('[beds24] 429 credit exhausted — backing off', { path, waitSec, ...credit });
    await sleep(waitMs);
    res = await fetch(url, init);
  }

  logCreditIfLow(path, parseCreditHeaders(res));
  return res;
}

export async function beds24Get(path: string, params?: Record<string, string>) {
  const token = await getBeds24Token();
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const res = await fetchBeds24(`${path}${qs}`, { headers: { token } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Beds24 GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function beds24Post(path: string, body: Record<string, unknown> | Record<string, unknown>[]) {
  const token = await getBeds24Token();
  const res = await fetchBeds24(path, {
    method: 'POST',
    headers: { token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Beds24 POST ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function beds24Put(path: string, body: Record<string, unknown> | Record<string, unknown>[]) {
  const token = await getBeds24Token();
  const res = await fetchBeds24(path, {
    method: 'PUT',
    headers: { token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Beds24 PUT ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export { BEDS24_BASE_URL, BEDS24_REFRESH_TOKEN };
