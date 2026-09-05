import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiClient } from '@/lib/api-auth';
import { withErrors } from '@/lib/core/http';

// v1 Properties — read-only. 파트너사가 자기 시스템과 매핑할 때 사용.
// GET /api/v1/properties — Auth: Bearer vd_live_… — Scope: properties:read
export const GET = withErrors('v1/properties', async (req) => {
  const auth = await requireApiClient(req, { scope: 'properties:read' });
  if (auth instanceof Response) return auth;

  // Property 테이블 자체를 조회하므로 propertyScopeFilter 대신 id 로 직접 필터.
  const properties = await prisma.property.findMany({
    where: auth.propertyIds.length > 0 ? { id: { in: auth.propertyIds } } : {},
    select: { id: true, name: true, timezone: true, beds24PropId: true, maxGuests: true },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ properties }, { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' } });
});
