import { prisma } from '@/lib/prisma';
import { withAuth, ok, created, fail, MESSAGES, visibleScope, readJson, str, int } from '@/lib/core/http';

/** 읽기 범위 한 규칙: 관리자 전체, 매니저 배정 숙소, 청소담당자 배정 지점(없으면 호스트 숙소 전부). */
export const GET = withAuth('properties', async (_req, { auth }) => {
  const visible = await visibleScope(auth);
  if (visible === null) return ok(await prisma.property.findMany({ orderBy: { createdAt: 'desc' } }));
  if (visible.length === 0) return ok([]);
  return ok(await prisma.property.findMany({ where: { id: { in: visible } }, orderBy: { createdAt: 'desc' } }));
});

export const POST = withAuth('properties', async (req, { auth }) => {
  if (auth.role === 'cleaner') throw fail(403, MESSAGES.forbidden);
  const body = await readJson(req);
  const name = str(body, 'name', { required: true, max: 100 })!.trim();

  const property = await prisma.property.create({
    data: {
      name,
      timezone: str(body, 'timezone', { max: 50 }) || 'Asia/Seoul',
      ownerId: auth.session.userId,
      beds24PropId: str(body, 'beds24PropId', { max: 50 }) ?? null,
      beds24RoomId: str(body, 'beds24RoomId', { max: 50 }) ?? null,
      doorPassword: str(body, 'doorPassword', { max: 50 }) ?? null,
      addressUrl: str(body, 'addressUrl', { max: 500 }) ?? null,
      roomReadyMessage: str(body, 'roomReadyMessage', { max: 2000 }) ?? null,
      basePrice: int(body, 'basePrice', { min: 0 }) ?? null,
      maxGuests: int(body, 'maxGuests', { min: 1, max: 100 }) ?? null,
      description: str(body, 'description', { max: 4000 }) ?? null,
    },
  });

  // 매니저가 만든 숙소는 자기 배정 목록에 바로 들어간다 (관리자는 전체 접근이라 불필요하지만 무해).
  await prisma.userProperty.create({ data: { userId: auth.session.userId, propertyId: property.id } });
  return created(property);
});
