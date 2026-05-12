import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiClient } from '@/lib/api-auth';

// v1 Properties — read-only. 파트너사가 자기 시스템과 매핑할 때 사용.
//
// GET /api/v1/properties
// Auth: Authorization: Bearer vd_live_...
// Scope: properties:read
//
// 응답:
//   { properties: [{ id, name, timezone, beds24PropId, maxGuests }] }

export async function GET(req: Request) {
  const auth = await requireApiClient(req, { scope: 'properties:read' });
  if (auth instanceof Response) return auth;

  // 이 라우트는 Property 테이블 자체를 조회 — propertyScopeFilter 의 `propertyId`
  // 필드가 아닌 `id` 로 직접 필터.
  const idFilter = auth.propertyIds.length > 0 ? { id: { in: auth.propertyIds } } : {};
  const properties = await prisma.property.findMany({
    where: idFilter,
    select: {
      id: true,
      name: true,
      timezone: true,
      beds24PropId: true,
      maxGuests: true,
    },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json(
    { properties },
    {
      headers: {
        // 파트너는 자기 시스템과 ID 매핑한 후 캐시해 두면 됨 — 짧은 SWR.
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    },
  );
}
