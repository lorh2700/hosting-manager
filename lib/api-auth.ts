import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';

// v1 외부 파트너 API 인증.
//
// 흐름: 요청의 `Authorization: Bearer vd_live_<32 random chars>` 추출 →
//       sha256 → DB 의 api_clients.key_hash 로 lookup → 만료/회수/scope 검증.
// 매 요청마다 last_used_at 을 갱신하면 write 부하가 커서, 5분 단위로만 갱신.

export type ApiClient = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  propertyIds: string[];
};

export type ApiAuthError =
  | { kind: 'missing_authorization' }
  | { kind: 'malformed_authorization' }
  | { kind: 'unknown_key' }
  | { kind: 'expired' }
  | { kind: 'revoked' }
  | { kind: 'forbidden_scope'; required: string; granted: string[] };

export type ApiAuthResult =
  | { ok: true; client: ApiClient }
  | { ok: false; error: ApiAuthError };

const KEY_FORMAT = /^vd_(live|test)_[A-Za-z0-9]{20,64}$/;
const LAST_USED_DEBOUNCE_MS = 5 * 60 * 1000;

function hashKey(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

function plainKeyPrefix(plain: string): string {
  // 'vd_live_a1b2c3d4...' 앞 16자 — 로그/UI 식별에 충분
  return plain.slice(0, 16);
}

/** 신규 키 발급용: 평문 + DB 저장용 hash + prefix. 평문은 호출자가 즉시 호스트에게 노출 후 잊어야 함. */
export function generateApiKey(env: 'live' | 'test' = 'live'): {
  plain: string;
  hash: string;
  prefix: string;
} {
  const random = randomBytes(24).toString('base64url');  // ~32 chars, URL-safe
  const plain = `vd_${env}_${random}`;
  return { plain, hash: hashKey(plain), prefix: plainKeyPrefix(plain) };
}

/**
 * 요청에서 Bearer 토큰 추출 후 DB 검증.
 * scope 인자를 주면 해당 scope 가 포함돼야 통과.
 */
export async function authenticateApiRequest(
  req: Request,
  options: { scope?: string } = {},
): Promise<ApiAuthResult> {
  const header = req.headers.get('authorization');
  if (!header) return { ok: false, error: { kind: 'missing_authorization' } };

  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return { ok: false, error: { kind: 'malformed_authorization' } };

  const plain = m[1].trim();
  if (!KEY_FORMAT.test(plain)) {
    return { ok: false, error: { kind: 'malformed_authorization' } };
  }

  const row = await prisma.apiClient.findUnique({
    where: { keyHash: hashKey(plain) },
    select: {
      id: true, name: true, keyPrefix: true, scopes: true, propertyIds: true,
      expiresAt: true, revokedAt: true, lastUsedAt: true,
    },
  });
  if (!row) return { ok: false, error: { kind: 'unknown_key' } };
  if (row.revokedAt) return { ok: false, error: { kind: 'revoked' } };
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: { kind: 'expired' } };
  }

  if (options.scope && !row.scopes.includes(options.scope)) {
    return {
      ok: false,
      error: { kind: 'forbidden_scope', required: options.scope, granted: row.scopes },
    };
  }

  // last_used_at 갱신 (write 부하 줄이려 debounce)
  const lastUsedMs = row.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - lastUsedMs > LAST_USED_DEBOUNCE_MS) {
    prisma.apiClient
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(err => console.warn('[api-auth] lastUsedAt update failed', err));
  }

  return {
    ok: true,
    client: {
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      scopes: row.scopes,
      propertyIds: row.propertyIds,
    },
  };
}

/** 인증 결과를 받아 거부 상태에 맞는 HTTP 응답 빌드. 라우트에서 ergonomic 하게 쓰는 헬퍼. */
export function apiAuthErrorResponse(error: ApiAuthError): NextResponse {
  switch (error.kind) {
    case 'missing_authorization':
    case 'malformed_authorization':
    case 'unknown_key':
    case 'expired':
    case 'revoked':
      return NextResponse.json(
        { error: 'Unauthorized', code: error.kind },
        { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="voidanchae-v1"' } },
      );
    case 'forbidden_scope':
      return NextResponse.json(
        { error: 'Forbidden', code: error.kind, required: error.required, granted: error.granted },
        { status: 403 },
      );
  }
}

/**
 * 라우트 핸들러용 one-liner. 인증 OK 면 client 반환, 아니면 Response 반환.
 * 사용:
 *   const auth = await requireApiClient(req, { scope: 'properties:read' });
 *   if (auth instanceof Response) return auth;
 *   // auth.client 사용
 */
export async function requireApiClient(
  req: Request,
  options: { scope?: string } = {},
): Promise<ApiClient | NextResponse> {
  const result = await authenticateApiRequest(req, options);
  if (!result.ok) return apiAuthErrorResponse(result.error);
  return result.client;
}

/**
 * client.propertyIds 가 비어 있으면 모든 지점 접근, 아니면 그 지점들로 제한.
 * Prisma where 절에 그대로 끼워 쓸 수 있는 형태로 반환.
 */
export function propertyScopeFilter(client: ApiClient) {
  if (client.propertyIds.length === 0) return {};
  return { propertyId: { in: client.propertyIds } };
}
