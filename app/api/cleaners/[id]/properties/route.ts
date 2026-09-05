import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, readJson } from '@/lib/core/http';

type Params = { id: string };

/**
 * Set the list of property IDs a cleaner is scoped to.
 * Empty array = no scope (cleaner sees all open cleanings).
 * Backed by the UserProperty table on the cleaner's linked user.
 */
export const PUT = withAuth<Params>('cleaners/properties', async (req, { params }) => {
  const body = await readJson(req);
  const propertyIds: string[] = Array.isArray(body.propertyIds)
    ? (body.propertyIds as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

  const cleaner = await prisma.cleaner.findUnique({ where: { id: params.id }, select: { id: true, userId: true } });
  if (!cleaner) throw fail(404, '청소 담당자를 찾을 수 없습니다.');
  if (!cleaner.userId) throw fail(400, '로그인 계정이 없는 담당자는 지점을 지정할 수 없습니다. 먼저 계정을 만들어 주세요.');

  if (propertyIds.length > 0) {
    const existing = await prisma.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true } });
    if (existing.length !== propertyIds.length) throw fail(400, '존재하지 않는 지점이 포함되어 있습니다.');
  }

  await prisma.$transaction([
    prisma.userProperty.deleteMany({ where: { userId: cleaner.userId } }),
    ...(propertyIds.length
      ? [prisma.userProperty.createMany({
          data: propertyIds.map(pid => ({ userId: cleaner.userId!, propertyId: pid })),
          skipDuplicates: true,
        })]
      : []),
  ]);

  return ok({ propertyIds });
}, { admin: true });
