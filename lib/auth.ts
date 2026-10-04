import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { prisma } from './prisma';
import { normalizeRole } from './access';
import type { UserRole } from './types';
import { normalizeModuleGrants, isModuleEnabled, type OperationalModule } from './operational-permissions';
import { assertOperationalAccess, propertyAllowsModule, requestOperationalModule, requestFeatureModules, isSelfProfileRequest, scopedAssignedPropertyIds } from './operational-access';
import { writeAuditLog } from './audit-log';
import { canManageTourOwner, type TourActor } from './tour-access';
import { operationalDatabase } from './operational-database';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET 환경변수가 설정되지 않았습니다.');
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const COOKIE_NAME = 'va_session';
// 모바일에서 주로 쓰므로 재로그인 부담을 줄이기 위해 30일. 정지·삭제된 계정은 토큰이 남아도 verifySession 에서 막힌다.
const SESSION_DAYS = 30;
const TOKEN_EXPIRY = `${SESSION_DAYS}d`;

export interface SessionUser {
  id: string;
  email: string;
}

export interface SessionProfile {
  cleanerId?: string;
  role: UserRole;
  propertyIds: string[];
  displayName: string;
  phone?: string;
  status: string;
  organizationId?: string | null;
  organizationName?: string | null;
  enabledModules?: OperationalModule[];
  organizationFeatures?: unknown;
}

/** Sign a JWT token */
export async function signToken(payload: { userId: string; email: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(TOKEN_EXPIRY)
    .setIssuedAt()
    .sign(JWT_SECRET);
}

/** Verify a JWT token */
export async function verifyToken(token: string): Promise<{ userId: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as { userId: string; email: string };
  } catch {
    return null;
  }
}

/** Set JWT cookie */
export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/** Clear JWT cookie */
export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/** Get session from cookie — for use in API routes (server-side) */
export async function getSession(): Promise<{ user: SessionUser; profile: SessionProfile } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  const dbUser = await operationalDatabase(() => prisma.user.findUnique({
    where: { id: payload.userId },
    include: { properties: { include: { property: { select: { organizationId: true } } } }, organization: true },
  }));

  if (!dbUser) return null;


  return {
    user: { id: dbUser.id, email: dbUser.email },
    profile: {
      cleanerId: dbUser.id,
      role: normalizeRole(dbUser.role),
      propertyIds: normalizeRole(dbUser.role) === 'admin'
        ? dbUser.organizationId ? (await operationalDatabase(() => prisma.property.findMany({ where: { organizationId: dbUser.organizationId }, select: { id: true } }))).map(p => p.id) : []
        : dbUser.properties.filter(p => (p.property.organizationId ?? null) === (dbUser.organizationId ?? null)).map((p) => p.propertyId),
      displayName: dbUser.displayName || dbUser.email,
      phone: dbUser.phone || undefined,
      status: dbUser.status,
      organizationId: dbUser.organizationId,
      organizationName: dbUser.organization?.name ?? null,
      enabledModules: normalizeModuleGrants(dbUser.enabledModules, normalizeRole(dbUser.role)).filter(module => normalizeRole(dbUser.role) === 'super_admin' || isModuleEnabled(module, dbUser.organization?.features)),
      organizationFeatures: dbUser.organization?.features,
    },
  };
}

/** 요청의 쿠키 또는 Bearer 헤더에서 JWT payload 만 꺼낸다 (DB 조회 없음). */
async function readTokenPayload(req: Request): Promise<{ userId: string; email: string } | null> {
  // Try cookie first
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  const token = match?.[1];

  if (!token) {
    // Try Authorization header
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      return verifyToken(authHeader.slice(7));
    }
    return null;
  }

  return verifyToken(token);
}

/**
 * Verify session from request (for API route protection).
 *
 * 승인 대기(pending_invite)·정지(suspended) 계정은 유효한 토큰이 있어도 API 를
 * 쓸 수 없다. 화면의 "승인 대기" 안내는 getSession() 경유라 영향받지 않는다.
 */
export async function verifySession(req: Request): Promise<{ userId: string; email: string } | null> {
  const payload = await readTokenPayload(req);
  if (!payload) return null;

  const user = await operationalDatabase(() => prisma.user.findUnique({
    where: { id: payload.userId },
    select: { status: true },
  }));
  if (!user || user.status !== 'active') return null;
  return payload;
}

/**
 * Authorize a request to act on a tour. Returns the tour's ownerId on
 * success, or null if unauthorized / not found. Admins always pass.
 *
 * Usage:
 *   const ok = await authorizeTour(tourId, session.userId);
 *   if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 */
export async function authorizeTour(
  tourId: string,
  userId: string,
  opts: { isAdmin?: boolean; auth?: TourActor } = {},
): Promise<{ ownerId: string } | null> {
  const tour = await prisma.tour.findUnique({
    where: { id: tourId },
    select: { ownerId: true, owner: { select: { organizationId: true } } },
  });
  if (!tour) return null;
  if (opts.isAdmin) return tour;
  return await authorizeTourOwner(tour, userId, opts) ? { ownerId: tour.ownerId } : null;
}

async function authorizeTourOwner(target: { ownerId: string; owner: { organizationId: string | null } }, userId: string, opts: { isAdmin?: boolean; auth?: TourActor }): Promise<boolean> {
  if (opts.isAdmin) return true;
  let actor = opts.auth;
  if (!actor) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true, role: true, status: true, enabledModules: true, organization: { select: { status: true, features: true } } } });
    if (!user || user.status !== 'active') return false;
    actor = { role: normalizeRole(user.role), session: { userId }, user, organizationFeatures: user.organization?.features, organizationStatus: user.organization?.status };
  }
  return canManageTourOwner(actor, { id: target.ownerId, organizationId: target.owner.organizationId });
}

export async function authorizeTourOperator(
  operatorId: string,
  userId: string,
  opts: { isAdmin?: boolean; auth?: TourActor } = {},
): Promise<{ ownerId: string } | null> {
  const op = await prisma.tourOperator.findUnique({
    where: { id: operatorId },
    select: { ownerId: true, owner: { select: { organizationId: true } } },
  });
  if (!op) return null;
  if (opts.isAdmin) return op;
  return await authorizeTourOwner(op, userId, opts) ? { ownerId: op.ownerId } : null;
}

export async function authorizeTourSchedule(
  scheduleId: string,
  userId: string,
  opts: { isAdmin?: boolean; auth?: TourActor } = {},
): Promise<{ tourId: string; ownerId: string } | null> {
  const s = await prisma.tourSchedule.findUnique({
    where: { id: scheduleId },
    select: { tourId: true, tour: { select: { ownerId: true, owner: { select: { organizationId: true } } } } },
  });
  if (!s) return null;
  if (opts.isAdmin) return { tourId: s.tourId, ownerId: s.tour.ownerId };
  return await authorizeTourOwner(s.tour, userId, opts) ? { tourId: s.tourId, ownerId: s.tour.ownerId } : null;
}

export async function authorizeTourDurationOption(
  optionId: string,
  userId: string,
  opts: { isAdmin?: boolean; auth?: TourActor } = {},
): Promise<{ tourId: string; ownerId: string } | null> {
  const o = await prisma.tourDurationOption.findUnique({
    where: { id: optionId },
    select: { tourId: true, tour: { select: { ownerId: true, owner: { select: { organizationId: true } } } } },
  });
  if (!o) return null;
  if (opts.isAdmin) return { tourId: o.tourId, ownerId: o.tour.ownerId };
  return await authorizeTourOwner(o.tour, userId, opts) ? { tourId: o.tourId, ownerId: o.tour.ownerId } : null;
}

export async function authorizeTourBooking(
  bookingId: string,
  userId: string,
  opts: { isAdmin?: boolean; auth?: TourActor } = {},
): Promise<{ tourId: string; ownerId: string; scheduleId: string | null; guests: number; status: string } | null> {
  const b = await prisma.tourBooking.findUnique({
    where: { id: bookingId },
    select: {
      tourId: true, scheduleId: true, guests: true, status: true,
      tour: { select: { ownerId: true, owner: { select: { organizationId: true } } } },
    },
  });
  if (!b) return null;
  const data = { tourId: b.tourId, ownerId: b.tour.ownerId, scheduleId: b.scheduleId, guests: b.guests, status: b.status };
  if (opts.isAdmin) return data;
  return await authorizeTourOwner(b.tour, userId, opts) ? data : null;
}

/**
 * Verify session AND load user + propertyIds in one step (eliminates duplicate DB queries).
 * 기본적으로 active 계정만 통과. allowInactive 는 승인 대기 화면처럼 계정 상태 자체를
 * 보여줘야 하는 극소수 경로에서만 쓴다.
 */
export async function getSessionWithUser(req: Request, opts: { allowInactive?: boolean } = {}) {
  const session = await readTokenPayload(req);
  if (!session) return null;

  const user = await operationalDatabase(() => prisma.user.findUnique({
    where: { id: session.userId },
    include: { properties: { select: { propertyId: true, property: { select: { organizationId: true, featureOverrides: true, organization: { select: { status: true, features: true } } } } } }, organization: { select: { id: true, name: true, status: true, features: true } } },
  }));
  if (!user) return null;
  if (!opts.allowInactive && user.status !== 'active') return null;

  // 옛 host/viewer 역할은 매니저로 정규화하고, 슈퍼매니저와 사업자 관리자는 구분한다.
  const role = normalizeRole(user.role);
  // isAdmin historically means an unrestricted database query. Keep it platform-only.
  const isAdmin = role === 'super_admin';
  const identity = { role, user, organizationFeatures: user.organization?.features, organizationStatus: user.organization?.status };
  const operationalModule = await isSelfProfileRequest(req, session.userId) ? null : requestOperationalModule(req, identity);
  const featureModules = requestFeatureModules(req, operationalModule);
  if (!opts.allowInactive) {
    try { assertOperationalAccess(identity, operationalModule, featureModules); }
    catch (error) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) await writeAuditLog({ session, user }, {
        action: `permission:${req.method}`, module: operationalModule, summary: '사용 권한이 없는 요청을 차단했습니다.', outcome: 'denied',
        details: { method: req.method, path: new URL(req.url).pathname, status: 403 },
      });
      throw error;
    }
  }
  const assigned = scopedAssignedPropertyIds(user.organizationId, user.properties, operationalModule, featureModules);
  const propertyIds = isAdmin ? null : role === 'admin'
    ? user.organizationId ? (await operationalDatabase(() => prisma.property.findMany({ where: { organizationId: user.organizationId }, select: { id: true, featureOverrides: true, organization: { select: { status: true, features: true } } } }))).filter(p => featureModules.every(feature => propertyAllowsModule(p, feature))).map(p => p.id) : []
    : assigned;
  return {
    session,
    user,
    role,
    isAdmin,
    isBusinessAdmin: role === 'admin',
    organizationId: user.organizationId,
    organizationFeatures: user.organization?.features,
    organizationStatus: user.organization?.status,
    operationalModule,
    featureModules,
    propertyIds,
  };
}

export type SessionAuth = NonNullable<Awaited<ReturnType<typeof getSessionWithUser>>>;
