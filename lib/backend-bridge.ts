import { randomUUID } from 'node:crypto';
import { readLegacySessionToken } from '../packages/domain/identity/legacy-session';

const managementPaths = [
  { source: /^\/api\/admin\/organizations$/, target: 'organizations', methods: ['GET', 'POST'] },
  { source: /^\/api\/admin\/organizations\/([^/]+)\/invite$/, target: 'organizations/$1/invitations', methods: ['POST'] },
  { source: /^\/api\/admin\/organizations\/([^/]+)$/, target: 'organizations/$1', methods: ['PATCH'] },
  { source: /^\/api\/admin\/operations-settings$/, target: 'settings', methods: ['GET', 'PUT'] },
  { source: /^\/api\/admin\/user-access\/([^/]+)$/, target: 'users/$1/access', methods: ['PATCH'] },
  { source: /^\/api\/admin\/property-requests$/, target: 'property-requests', methods: ['GET', 'POST'] },
  { source: /^\/api\/admin\/property-requests\/([^/]+)$/, target: 'property-requests/$1', methods: ['PATCH'] },
  { source: /^\/api\/admin\/activity$/, target: 'activity', methods: ['GET'] },
];

export function managementBackendPath(path: string, method: string): string | null {
  const rule = managementPaths.find(item => item.methods.includes(method) && item.source.test(path));
  return rule ? `/api/app/v1/${path.replace(rule.source, rule.target)}` : null;
}

function localError(status: number, code: string, message: string, legacy: boolean, requestId: string, retryable = false): Response {
  const error = { code, message, retryable };
  return Response.json(legacy ? { error: message, code, retryable } : { error, meta: { requestId } }, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId },
  });
}

function unavailable(legacy: boolean, requestId: string): Response {
  return localError(503, 'BACKEND_UNAVAILABLE', '관리 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', legacy, requestId, true);
}

const MAX_BODY_BYTES = 65_536;

async function boundedBody(req: Request): Promise<string | null> {
  const contentLength = req.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export async function forwardBackendRequest(req: Request, path: string, options: { legacy?: boolean; env?: NodeJS.ProcessEnv; fetcher?: typeof fetch } = {}): Promise<Response> {
  const { legacy = false, env = process.env, fetcher = fetch } = options;
  const requestId = randomUUID();
  if (!env.BACKEND_API_URL || !env.BACKEND_BRIDGE_SECRET || env.BACKEND_BRIDGE_SECRET.length < 32 || !env.BACKEND_WEB_ORIGIN) return unavailable(legacy, requestId);
  try {
    const base = new URL(env.BACKEND_API_URL);
    if (base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
      !(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) return unavailable(legacy, requestId);
    if (!/^\/api\/app\/v1\/[A-Za-z0-9/_-]+$/.test(path)) return localError(400, 'INVALID_REQUEST', '잘못된 요청 경로입니다.', legacy, requestId);
    const url = new URL(req.url);
    const token = readLegacySessionToken(req.headers);
    if (!token) return localError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.', legacy, requestId);
    const mutation = !['GET', 'HEAD'].includes(req.method);
    const origin = new URL(env.BACKEND_WEB_ORIGIN).origin;
    if (mutation && req.headers.get('origin') !== origin) return localError(403, 'FORBIDDEN', '허용되지 않은 요청 출처입니다.', legacy, requestId);
    const headers = new Headers({ 'x-backend-key': env.BACKEND_BRIDGE_SECRET, cookie: `va_session=${token}`, accept: 'application/json' });
    let body: string | undefined;
    if (mutation) {
      const key = req.headers.get('idempotency-key');
      if (!key || !/^[A-Za-z0-9_.:-]{16,200}$/.test(key)) return localError(400, 'IDEMPOTENCY_KEY_REQUIRED', '유효한 Idempotency-Key가 필요합니다.', legacy, requestId);
      const content = await boundedBody(req);
      if (content === null) return localError(413, 'PAYLOAD_TOO_LARGE', '요청 내용이 너무 큽니다.', legacy, requestId);
      body = content;
      headers.set('origin', origin);
      headers.set('content-type', req.headers.get('content-type') || 'application/json');
      headers.set('idempotency-key', key);
    }
    const target = new URL(path, base);
    target.search = url.search;
    const response = await fetcher(target, { method: req.method, headers, body, signal: AbortSignal.timeout(12_000), redirect: 'error', cache: 'no-store' });
    const responseHeaders = new Headers({ 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId });
    for (const name of ['x-request-id', 'x-access-revision']) { const value = response.headers.get(name); if (value) responseHeaders.set(name, value); }
    if (req.method === 'HEAD') return new Response(null, { status: response.status, headers: responseHeaders });
    const data = await response.json();
    if (!data || typeof data !== 'object' || !data.meta || typeof data.meta !== 'object' ||
      typeof data.meta.requestId !== 'string' || !(response.ok ? 'data' in data : 'error' in data) ||
      (!response.ok && (!data.error || typeof data.error !== 'object' || typeof data.error.message !== 'string' ||
        typeof data.error.code !== 'string' || typeof data.error.retryable !== 'boolean'))) return unavailable(legacy, requestId);
    responseHeaders.set('X-Request-Id', data.meta.requestId);
    const result = legacy ? response.ok ? data.data : { ...(data.error.details || {}), error: data.error.message, code: data.error.code, retryable: data.error.retryable } : data;
    return Response.json(result, { status: response.status, headers: responseHeaders });
  } catch {
    // An uncertain remote write must never fall back to a second local execution.
    return unavailable(legacy, requestId);
  }
}

export async function maybeProxyManagementRequest(req: Request): Promise<Response | null> {
  if (process.env.BACKEND_MANAGEMENT_ENABLED !== 'true') return null;
  const path = managementBackendPath(new URL(req.url).pathname, req.method);
  return path ? forwardBackendRequest(req, path, { legacy: true }) : null;
}
