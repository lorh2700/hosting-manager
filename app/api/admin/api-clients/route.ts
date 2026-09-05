import { prisma } from '@/lib/prisma';
import { generateApiKey } from '@/lib/api-auth';
import { withAuth, ok, created, fail, readJson, str } from '@/lib/core/http';

const ALLOWED_SCOPES = ['properties:read', 'bookings:read', 'cleanings:read', 'cleanings:write'] as const;

export const GET = withAuth('admin/api-clients', async () => {
  return ok(await prisma.apiClient.findMany({
    select: {
      id: true, name: true, keyPrefix: true, scopes: true, propertyIds: true,
      expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  }));
}, { admin: true });

export const POST = withAuth('admin/api-clients', async (req, { auth }) => {
  const body = await readJson(req);
  const name = str(body, 'name', { required: true, max: 100 })!.trim();

  const scopes = Array.isArray(body.scopes) ? (body.scopes as unknown[]).filter((s): s is string => typeof s === 'string') : [];
  const badScope = scopes.find(s => !(ALLOWED_SCOPES as readonly string[]).includes(s));
  if (badScope) throw fail(400, `unknown scope: ${badScope}`, { allowed: ALLOWED_SCOPES });

  const propertyIds = Array.isArray(body.propertyIds) ? (body.propertyIds as unknown[]).filter((p): p is string => typeof p === 'string' && !!p) : [];
  const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw fail(400, 'expiresAt must be ISO datetime');

  const { plain, hash, prefix } = generateApiKey('live');
  const client = await prisma.apiClient.create({
    data: { name, keyPrefix: prefix, keyHash: hash, scopes, propertyIds, expiresAt, createdBy: auth.user.id },
    select: { id: true, name: true, keyPrefix: true, scopes: true, propertyIds: true, expiresAt: true, createdAt: true },
  });

  // 평문 키는 응답 1회만 노출 — DB 에 평문 저장 안 함.
  return created({ ...client, plaintextKey: plain });
}, { admin: true });
