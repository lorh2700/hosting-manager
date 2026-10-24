import { jwtVerify } from 'jose';

export const LEGACY_SESSION_COOKIE = 'va_session';

export interface LegacySessionClaims {
  userId: string;
  email: string;
  expiresAt: number;
}

export interface SessionHeaders {
  get(name: string): string | null;
}

export function readLegacySessionToken(headers: SessionHeaders, options: { allowBearer?: boolean } = {}): string | null {
  const values = (headers.get('cookie') ?? '').split(';').flatMap(part => {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== LEGACY_SESSION_COOKIE) return [];
    return [part.slice(separator + 1).trim()];
  });
  // An invalid or ambiguous cookie must not fall through to another identity.
  if (values.length) return values.length === 1 && values[0] ? values[0] : null;
  if (!options.allowBearer) return null;
  const bearer = headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i);
  return bearer?.[1] ?? null;
}

export async function verifyLegacySessionToken(
  token: string,
  secret: string | Uint8Array,
  now?: Date,
): Promise<LegacySessionClaims | null> {
  if (!secret.length) throw new Error('JWT_SECRET is required for legacy session verification');
  if (!token || token.length > 16_384) return null;
  try {
    const { payload } = await jwtVerify(token, typeof secret === 'string' ? new TextEncoder().encode(secret) : secret, {
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'userId', 'email'],
      ...(now ? { currentDate: now } : {}),
    });
    if (typeof payload.userId !== 'string' || !payload.userId.trim() ||
      typeof payload.email !== 'string' || !payload.email.trim() ||
      typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
    return { userId: payload.userId, email: payload.email, expiresAt: payload.exp };
  } catch {
    return null;
  }
}
