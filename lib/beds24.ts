const BEDS24_REFRESH_TOKEN = process.env.BEDS24_REFRESH_TOKEN;
const BEDS24_BASE_URL = 'https://beds24.com/api/v2';

// Token cache (in-memory, valid for ~60 mins per Beds24 docs)
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export async function getBeds24Token(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 300_000) {
    return cachedToken;
  }
  if (!BEDS24_REFRESH_TOKEN) throw new Error('BEDS24_REFRESH_TOKEN is not configured');
  const res = await fetch(`${BEDS24_BASE_URL}/authentication/token`, {
    headers: { refreshToken: BEDS24_REFRESH_TOKEN },
  });
  if (!res.ok) throw new Error(`Beds24 token refresh failed: ${res.status}`);
  const data = await res.json();
  if (!data.token) throw new Error('No token in Beds24 response');
  cachedToken = data.token;
  tokenExpiresAt = Date.now() + 3_600_000;
  return cachedToken!;
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
