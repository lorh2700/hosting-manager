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
