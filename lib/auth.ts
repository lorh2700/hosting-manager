import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { prisma } from './prisma';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET 환경변수가 설정되지 않았습니다.');
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const COOKIE_NAME = 'va_session';
const TOKEN_EXPIRY = '7d';

export interface SessionUser {
  id: string;
  email: string;
}

export interface SessionProfile {
  role: string;
  propertyIds: string[];
  displayName: string;
  phone?: string;
  status: string;
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
    maxAge: 7 * 24 * 60 * 60, // 7 days
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

  const dbUser = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { properties: true },
  });

  if (!dbUser) return null;

  return {
    user: { id: dbUser.id, email: dbUser.email },
    profile: {
      role: dbUser.role,
      propertyIds: dbUser.properties.map((p) => p.propertyId),
      displayName: dbUser.displayName || dbUser.email,
      phone: dbUser.phone || undefined,
      status: dbUser.status,
    },
  };
}

/** Verify session from request (for API route protection) */
export async function verifySession(req: Request): Promise<{ userId: string; email: string } | null> {
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
  opts: { isAdmin?: boolean } = {},
): Promise<{ ownerId: string } | null> {
  const tour = await prisma.tour.findUnique({
    where: { id: tourId },
    select: { ownerId: true },
  });
  if (!tour) return null;
  if (opts.isAdmin) return tour;
  return tour.ownerId === userId ? tour : null;
}

export async function authorizeTourOperator(
  operatorId: string,
  userId: string,
  opts: { isAdmin?: boolean } = {},
): Promise<{ ownerId: string } | null> {
  const op = await prisma.tourOperator.findUnique({
    where: { id: operatorId },
    select: { ownerId: true },
  });
  if (!op) return null;
  if (opts.isAdmin) return op;
  return op.ownerId === userId ? op : null;
}

export async function authorizeTourSchedule(
  scheduleId: string,
  userId: string,
  opts: { isAdmin?: boolean } = {},
): Promise<{ tourId: string; ownerId: string } | null> {
  const s = await prisma.tourSchedule.findUnique({
    where: { id: scheduleId },
    select: { tourId: true, tour: { select: { ownerId: true } } },
  });
  if (!s) return null;
  if (opts.isAdmin) return { tourId: s.tourId, ownerId: s.tour.ownerId };
  return s.tour.ownerId === userId ? { tourId: s.tourId, ownerId: s.tour.ownerId } : null;
}

export async function authorizeTourDurationOption(
  optionId: string,
  userId: string,
  opts: { isAdmin?: boolean } = {},
): Promise<{ tourId: string; ownerId: string } | null> {
  const o = await prisma.tourDurationOption.findUnique({
    where: { id: optionId },
    select: { tourId: true, tour: { select: { ownerId: true } } },
  });
  if (!o) return null;
  if (opts.isAdmin) return { tourId: o.tourId, ownerId: o.tour.ownerId };
  return o.tour.ownerId === userId ? { tourId: o.tourId, ownerId: o.tour.ownerId } : null;
}

export async function authorizeTourBooking(
  bookingId: string,
  userId: string,
  opts: { isAdmin?: boolean } = {},
): Promise<{ tourId: string; ownerId: string; scheduleId: string; guests: number; status: string } | null> {
  const b = await prisma.tourBooking.findUnique({
    where: { id: bookingId },
    select: {
      tourId: true, scheduleId: true, guests: true, status: true,
      tour: { select: { ownerId: true } },
    },
  });
  if (!b) return null;
  const data = { tourId: b.tourId, ownerId: b.tour.ownerId, scheduleId: b.scheduleId, guests: b.guests, status: b.status };
  if (opts.isAdmin) return data;
  return b.tour.ownerId === userId ? data : null;
}

/** Verify session AND load user + propertyIds in one step (eliminates duplicate DB queries) */
export async function getSessionWithUser(req: Request) {
  const session = await verifySession(req);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { properties: { select: { propertyId: true } } },
  });
  if (!user) return null;

  const isAdmin = ['super_admin', 'admin'].includes(user.role);

  return {
    session,
    user,
    isAdmin,
    propertyIds: isAdmin
      ? null // null = all properties (caller should query without filter)
      : user.properties.map(p => p.propertyId),
  };
}
