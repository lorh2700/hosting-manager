import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';
import { generateApiKey } from '@/lib/api-auth';

const ALLOWED_SCOPES = [
  'properties:read',
  'bookings:read',
  'cleanings:read',
  'cleanings:write',
] as const;

async function requireSuperAdmin(req: Request) {
  const session = await verifySession(req);
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !['super_admin', 'admin'].includes(user.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user };
}

export async function GET(req: Request) {
  const guard = await requireSuperAdmin(req);
  if ('error' in guard) return guard.error;

  const clients = await prisma.apiClient.findMany({
    select: {
      id: true, name: true, keyPrefix: true, scopes: true, propertyIds: true,
      expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(clients);
}

export async function POST(req: Request) {
  const guard = await requireSuperAdmin(req);
  if ('error' in guard) return guard.error;

  let body: {
    name?: string;
    scopes?: string[];
    propertyIds?: string[];
    expiresAt?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const scopes = Array.isArray(body.scopes) ? body.scopes : [];
  const badScope = scopes.find((s) => !ALLOWED_SCOPES.includes(s as (typeof ALLOWED_SCOPES)[number]));
  if (badScope) {
    return NextResponse.json(
      { error: `unknown scope: ${badScope}`, allowed: ALLOWED_SCOPES },
      { status: 400 },
    );
  }

  const propertyIds = Array.isArray(body.propertyIds) ? body.propertyIds.filter(Boolean) : [];
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json({ error: 'expiresAt must be ISO datetime' }, { status: 400 });
  }

  const { plain, hash, prefix } = generateApiKey('live');

  const created = await prisma.apiClient.create({
    data: {
      name, keyPrefix: prefix, keyHash: hash,
      scopes, propertyIds,
      expiresAt: expiresAt ?? null,
      createdBy: guard.user.id,
    },
    select: {
      id: true, name: true, keyPrefix: true, scopes: true, propertyIds: true,
      expiresAt: true, createdAt: true,
    },
  });

  // 평문 키는 응답 1회만 노출 — DB 에 평문 저장 안 함.
  return NextResponse.json({ ...created, plaintextKey: plain }, { status: 201 });
}
