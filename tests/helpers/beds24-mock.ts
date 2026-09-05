/**
 * 전역 fetch 를 가로채 Beds24 API 를 흉내낸다. 요청은 `fetchLog` 와 prisma 스텁의 `calls` 에 함께
 * 기록되어 "Beds24 확인 → DB 저장" 같은 순서를 검증할 수 있다.
 */
import { calls } from '../stubs/prisma';

export interface FetchEntry { method: string; url: string; body?: any; status?: number; token?: string }
export const fetchLog: FetchEntry[] = [];

type Handler = (url: URL, init: { method: string; headers: Record<string, string>; body?: string }) => Response | Promise<Response>;
let handler: Handler = () => { throw new Error('no fetch handler installed'); };

export function setFetchHandler(h: Handler) { handler = h; }
export function resetFetch() { fetchLog.length = 0; }

globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input);
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = init.headers ?? {};
  const body = init.body ? JSON.parse(init.body) : undefined;
  const entry: FetchEntry = { method, url, body, token: headers.token };
  fetchLog.push(entry);
  const u = new URL(url);
  calls.push(`${method} ${u.pathname.replace('/api/v2', '')}${u.search}`);
  const res = await handler(u, { ...init, method, headers });
  entry.status = res.status;
  return res;
}) as typeof fetch;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export const sampleBooking = (over: Record<string, unknown> = {}) => ({
  id: 123, roomId: 555, propertyId: 111, status: 'confirmed',
  arrival: '2026-10-01', departure: '2026-10-03',
  firstName: '홍길동', lastName: '', bookingTime: '2026-09-05T00:00:00',
  ...over,
});

export interface Beds24MockOptions {
  onCreate?: (body: any[]) => Response;
  onGetById?: (id: string) => Response;
  onSearch?: (params: URLSearchParams) => Response;
  onMessages?: (params: URLSearchParams) => Response;
  onToken?: (n: number) => Response;
  /** 지정하면 이 토큰만 유효 — 다른 토큰은 401 */
  validTokens?: string[];
}

/** 토큰 발급 + /bookings 계열을 처리하는 기본 Beds24 핸들러. */
export function installBeds24Mock(opts: Beds24MockOptions = {}) {
  let tokenCounter = 0;
  setFetchHandler((u, init) => {
    if (u.pathname.endsWith('/authentication/token')) {
      tokenCounter++;
      return opts.onToken ? opts.onToken(tokenCounter) : json({ token: `tok-${tokenCounter}`, expiresIn: 86400 });
    }
    if (opts.validTokens && !opts.validTokens.includes(init.headers.token)) {
      return json({ success: false, code: 401, error: 'Invalid token' }, 401);
    }
    if (u.pathname.endsWith('/bookings/messages')) {
      return opts.onMessages ? opts.onMessages(u.searchParams) : json({ success: true, data: [] });
    }
    if (u.pathname.endsWith('/bookings') && init.method === 'POST') {
      const body = JSON.parse(init.body!);
      return opts.onCreate ? opts.onCreate(body) : json([{ success: true, new: sampleBooking() }]);
    }
    if (u.pathname.endsWith('/bookings') && init.method === 'PUT') {
      const body = JSON.parse(init.body!);
      return json([{ success: true, modified: { id: Number(body[0].id) } }]);
    }
    if (u.pathname.endsWith('/bookings') && init.method === 'GET') {
      const id = u.searchParams.get('id');
      if (id) return opts.onGetById ? opts.onGetById(id) : json({ success: true, data: [sampleBooking()] });
      return opts.onSearch ? opts.onSearch(u.searchParams) : json({ success: true, data: [], pages: { nextPageExists: false } });
    }
    throw new Error(`unexpected request ${init.method} ${u.href}`);
  });
}

export const postsTo = (path: string) => fetchLog.filter(l => l.method === 'POST' && l.url.includes(path));
export const tokenCalls = () => fetchLog.filter(l => l.url.includes('/authentication/token'));

/** 라우트 핸들러에 넘길 가짜 Request. */
export function makeRequest(body: unknown, url = 'http://localhost/api/test'): Request {
  return { json: async () => body, url, headers: new Headers() } as unknown as Request;
}

/** NextResponse 스텁 결과를 검사용 형태로. */
// 라우트 핸들러는 타입상 (req, ctx) 두 인자지만 정적 라우트는 ctx 없이 호출해도 동작한다.
export async function callRoute(fn: (req: Request, ctx?: any) => Promise<unknown>, req: Request): Promise<{ status: number; body: any }> {
  return (await fn(req)) as { status: number; body: any };
}
