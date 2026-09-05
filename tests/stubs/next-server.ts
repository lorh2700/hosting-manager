/** 'next/server' 스텁 — NextResponse.json 을 검사하기 쉬운 평범한 객체로 바꾼다. */
export interface StubResponse {
  status: number;
  body: any;
  headers: Headers;
}

export const NextResponse = {
  json(body: any, init?: { status?: number; headers?: Record<string, string> }): StubResponse {
    return { status: init?.status ?? 200, body, headers: new Headers(init?.headers) };
  },
  next() { return { status: 200, body: null, headers: new Headers() }; },
  redirect(url: string | URL) { return { status: 307, body: null, headers: new Headers({ location: String(url) }) }; },
};

export class NextRequest extends Request {
  get nextUrl() { return new URL(this.url); }
}
