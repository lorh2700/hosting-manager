import { prisma } from '@/lib/prisma';
import { canManageCleaner } from '@/lib/access';
import { withAuth, ok, fail, MESSAGES, readJson } from '@/lib/core/http';

type Params = { id: string };

/**
 * 담당자의 배정 지점(CleanerProperty)을 통째로 바꾼다.
 * 빈 배열 = 배정 없음 → 소유 호스트의 모든 숙소를 본다.
 * 로그인 계정 유무와 무관하게 동작한다 (공개 링크만 쓰는 담당자도 배정 가능).
 */
export const PUT = withAuth<Params>('cleaners/properties', async (req, { auth, params }) => {
  const body = await readJson(req);
  const propertyIds = Array.isArray(body.propertyIds)
    ? [...new Set((body.propertyIds as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0))]
    : [];

  const cleaner = await prisma.cleaner.findUnique({ where: { id: params.id }, select: { id: true, ownerId: true } });
  if (!cleaner) throw fail(404, '청소 담당자를 찾을 수 없습니다.');
  if (!canManageCleaner(auth, cleaner)) throw fail(403, MESSAGES.forbidden);

  if (propertyIds.length > 0) {
    const existing = await prisma.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true } });
    if (existing.length !== propertyIds.length) throw fail(400, '존재하지 않는 지점이 포함되어 있습니다.');
  }

  await prisma.$transaction([
    prisma.cleanerProperty.deleteMany({ where: { cleanerId: cleaner.id } }),
    ...(propertyIds.length
      ? [prisma.cleanerProperty.createMany({
          data: propertyIds.map(pid => ({ cleanerId: cleaner.id, propertyId: pid })),
          skipDuplicates: true,
        })]
      : []),
  ]);

  return ok({ propertyIds });
});
