import { prisma } from '@/lib/prisma';
import { withErrors, ok } from '@/lib/core/http';

// 공개 숙소 목록 (예약 페이지). 표시용 최소 필드만 노출한다.
export const GET = withErrors('public/properties', async () => {
  const properties = await prisma.property.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, timezone: true, description: true },
  });
  return ok(properties.map(p => ({ ...p, imageUrl: null, images: [], region: null, description: p.description ?? null })));
});
