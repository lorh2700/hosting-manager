/**
 * API 라우트 공통 계층.
 *
 *  - withAuth(): 세션 확인 → (선택) 관리자 확인 → 핸들러 실행 → 예외를 표준 응답으로 변환
 *  - HttpError / fail(): 핸들러 안에서 던지면 그대로 상태코드+메시지 응답이 된다
 *  - 권한 헬퍼: requireManage / requireOwnerOrAdmin / visibleScope
 *  - 입력 헬퍼: readJson / str / dateStr / int
 *
 * 라우트는 "인증 래퍼 → 입력 검증 → 도메인 함수 호출 → 응답" 네 줄로 끝나야 한다.
 * 문구·상태코드는 여기에서만 정의한다 (라우트마다 다시 쓰지 않는다).
 */
import { NextResponse } from 'next/server';
import {
  getSessionWithUser,
  canManageProperty,
  getVisiblePropertyIds,
  isPropertyOwnerOrAdmin,
  type SessionAuth,
} from '@/lib/auth';

export const MESSAGES = {
  unauthorized: 'Unauthorized',
  forbidden: '권한이 없습니다.',
  notFound: '찾을 수 없습니다.',
  badJson: '잘못된 JSON 본문입니다.',
  server: '서버 오류가 발생했습니다.',
  noFields: '업데이트할 필드가 없습니다.',
} as const;

export class HttpError extends Error {
  readonly status: number;
  readonly extra?: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.extra = extra;
  }
}

/** 핸들러 안에서 `throw fail(404, '숙소를 찾을 수 없습니다.')` 처럼 쓴다. */
export function fail(status: number, message: string, extra?: Record<string, unknown>): HttpError {
  return new HttpError(status, message, extra);
}

export const errorResponse = (status: number, message: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ error: message, ...(extra ?? {}) }, { status });

export const ok = (body: unknown, status = 200) => NextResponse.json(body, { status });
export const created = (body: unknown) => NextResponse.json(body, { status: 201 });

export type RouteLog = (msg: string, extra?: unknown) => void;

export interface AuthedContext<P> {
  auth: SessionAuth;
  params: P;
  log: RouteLog;
}

export type AuthedHandler<P> = (req: Request, ctx: AuthedContext<P>) => Promise<Response>;

export interface WithAuthOptions {
  /** 관리자(super_admin/admin)만 허용 */
  admin?: boolean;
  /** 승인 대기·정지 계정도 통과 (계정 상태 화면 등 극소수 경로) */
  allowInactive?: boolean;
}

type RouteContext<P> = { params: Promise<P> };

/**
 * 인증이 필요한 라우트 핸들러를 감싼다.
 *   export const GET = withAuth('events', async (req, { auth }) => { ... });
 *   export const PUT = withAuth<{ id: string }>('properties/id', async (req, { auth, params }) => { ... });
 */
export function withAuth<P = Record<string, never>>(
  name: string,
  handler: AuthedHandler<P>,
  opts: WithAuthOptions = {},
) {
  const log: RouteLog = (msg, extra) =>
    extra === undefined ? console.log(`[${name}] ${msg}`) : console.log(`[${name}] ${msg}`, extra);

  return async (req: Request, routeCtx?: RouteContext<P>): Promise<Response> => {
    try {
      const auth = await getSessionWithUser(req, { allowInactive: opts.allowInactive });
      if (!auth) return errorResponse(401, MESSAGES.unauthorized);
      if (opts.admin && !auth.isAdmin) return errorResponse(403, MESSAGES.forbidden);
      const params = routeCtx ? await routeCtx.params : ({} as P);
      return await handler(req, { auth, params, log });
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e.status, e.message, e.extra);
      console.error(`[${name}] error:`, e);
      return errorResponse(500, MESSAGES.server);
    }
  };
}

/** 인증 없는 라우트(공개·비밀키 검사 자체 수행)도 같은 예외 변환을 쓰도록 하는 래퍼. */
export function withErrors<P = Record<string, never>>(
  name: string,
  handler: (req: Request, ctx: { params: P; log: RouteLog }) => Promise<Response>,
) {
  const log: RouteLog = (msg, extra) =>
    extra === undefined ? console.log(`[${name}] ${msg}`) : console.log(`[${name}] ${msg}`, extra);
  return async (req: Request, routeCtx?: RouteContext<P>): Promise<Response> => {
    try {
      const params = routeCtx ? await routeCtx.params : ({} as P);
      return await handler(req, { params, log });
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e.status, e.message, e.extra);
      console.error(`[${name}] error:`, e);
      return errorResponse(500, MESSAGES.server);
    }
  };
}

/** 크론이 x-cron-secret 으로 호출했는지. 비밀키가 설정돼 있고 일치할 때만 true. */
export function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('x-cron-secret');
  return !!header && !!secret && header === secret;
}

/** 크론 비밀키 또는 로그인 세션 중 하나. 둘 다 없으면 401. 세션이면 auth 를 돌려준다. */
export async function cronOrSession(req: Request): Promise<SessionAuth | null> {
  if (isCronRequest(req)) return null;
  const auth = await getSessionWithUser(req);
  if (!auth) throw fail(401, MESSAGES.unauthorized);
  return auth;
}

// ── 권한 ───────────────────────────────────────────────────────────────────

/** 쓰기 권한(관리자 또는 담당 호스트)이 없으면 403. */
export function requireManage(auth: SessionAuth, propertyId: string): void {
  if (!canManageProperty(auth, propertyId)) throw fail(403, MESSAGES.forbidden);
}

/** 되돌리기 어려운 작업: 관리자 또는 숙소 소유자만. */
export async function requireOwnerOrAdmin(auth: SessionAuth, propertyId: string): Promise<void> {
  if (!(await isPropertyOwnerOrAdmin(auth, propertyId))) throw fail(403, MESSAGES.forbidden);
}

/**
 * 읽기 범위. null 이면 전체(관리자), 배열이면 그 숙소들만.
 * 요청한 숙소 목록과의 교집합이 비면 빈 배열 — 호출자는 빈 결과를 돌려주면 된다.
 */
export function visibleScope(auth: SessionAuth, requested?: string[] | null): Promise<string[] | null> {
  return getVisiblePropertyIds(auth, requested);
}

/** 볼 수 있는 숙소가 아니면 403. */
export async function requireVisible(auth: SessionAuth, propertyId: string): Promise<void> {
  const visible = await getVisiblePropertyIds(auth, [propertyId]);
  if (visible !== null && visible.length === 0) throw fail(403, MESSAGES.forbidden);
}

// ── 입력 ───────────────────────────────────────────────────────────────────

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw fail(400, MESSAGES.badJson);
  }
}

/** 문자열 필드. 없거나 문자열이 아니면 undefined (required 면 400). */
export function str(body: Record<string, unknown>, key: string, opts: { required?: boolean; max?: number } = {}): string | undefined {
  const v = body[key];
  if (typeof v !== 'string' || (opts.required && !v.trim())) {
    if (opts.required) throw fail(400, `${key}은(는) 필수입니다.`);
    return undefined;
  }
  return opts.max ? v.slice(0, opts.max) : v;
}

/** YYYY-MM-DD 문자열. 형식이 틀리면 400. */
export function dateStr(body: Record<string, unknown>, key: string, opts: { required?: boolean } = {}): string | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw fail(400, `${key}은(는) 필수입니다.`);
    return undefined;
  }
  const s = String(v).slice(0, 10);
  if (!DATE_RE.test(s)) throw fail(400, `${key}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  return s;
}

/** 정수 필드 (범위 제한 포함). 없으면 undefined. */
export function int(body: Record<string, unknown>, key: string, opts: { min?: number; max?: number } = {}): number | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw fail(400, `${key}은(는) 숫자여야 합니다.`);
  const clamped = Math.floor(n);
  if (opts.min !== undefined && clamped < opts.min) return opts.min;
  if (opts.max !== undefined && clamped > opts.max) return opts.max;
  return clamped;
}

/** 쿼리스트링의 콤마 구분 id 목록. */
export function idList(req: Request, key: string): string[] | undefined {
  const raw = new URL(req.url).searchParams.get(key);
  const list = raw?.split(',').map(s => s.trim()).filter(Boolean);
  return list?.length ? list : undefined;
}

export function query(req: Request, key: string): string | null {
  return new URL(req.url).searchParams.get(key);
}

/** 쿼리 파라미터 id — 없으면 400. */
export function requireQuery(req: Request, key: string): string {
  const v = query(req, key);
  if (!v) throw fail(400, `${key}은(는) 필수입니다.`);
  return v;
}
