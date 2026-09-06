import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET 환경변수가 설정되지 않았습니다.');
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const COOKIE_NAME = 'va_session';

const PUBLIC_PATHS = [
  '/login',
  '/setup',
  '/invite',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/public',
  '/api/setup',
  // 아래 세 경로는 크론(x-cron-secret)이 쿠키 없이 호출한다. 라우트 안에서
  // 비밀키 또는 세션을 직접 검사하므로 미들웨어만 통과시킨다.
  '/api/sync',
  '/api/cron/',
  '/api/beds24/sync-all',
  '/api/beds24/messages',
  // OTA 가 가져가는 iCal 내보내기 — 채널별 토큰 URL 로만 접근 가능.
  '/api/export/',
  '/book',
  '/_next',
  '/favicon.ico',
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static files — 페이지 경로에만 해당. API 경로는 점(.)이 있어도 인증 대상.
  if (!pathname.startsWith('/api/') && pathname.includes('.')) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    // API routes return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Pages redirect to login
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    await jwtVerify(token, JWT_SECRET);
    return NextResponse.next();
  } catch {
    // Invalid token — clear cookie and redirect
    const response = pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', req.url));
    response.cookies.delete(COOKIE_NAME);
    return response;
  }
}

export const config = {
  matcher: ['/admin/:path*', '/cleaner/:path*', '/api/:path*'],
};
