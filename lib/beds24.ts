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

export async function beds24Get(path: string, params?: Record<string, string>) {
  const token = await getBeds24Token();
  const url = params
    ? `${BEDS24_BASE_URL}${path}?${new URLSearchParams(params)}`
    : `${BEDS24_BASE_URL}${path}`;
  const res = await fetch(url, { headers: { token } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Beds24 GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function beds24Post(path: string, body: Record<string, unknown> | Record<string, unknown>[]) {
  const token = await getBeds24Token();
  const res = await fetch(`${BEDS24_BASE_URL}${path}`, {
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
  const res = await fetch(`${BEDS24_BASE_URL}${path}`, {
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
