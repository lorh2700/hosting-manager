import { prisma } from '@/lib/prisma';
import { getCleaningPropertyIds } from '@/lib/access';
import { OPERATIONAL_MODULES, isModuleEnabled } from '@/lib/operational-permissions';
import { withAuth, ok, created, fail, MESSAGES, visibleScope, readJson, str, int } from '@/lib/core/http';

/** 읽기 범위 한 규칙: 관리자 전체, 매니저 배정 숙소, 청소담당자 배정 지점(없으면 호스트 숙소 전부). */
export const GET = withAuth('properties', async (_req, { auth }) => {
  const visible = new URL(_req.url).searchParams.get('work') === 'cleaner' ? await getCleaningPropertyIds(auth) : await visibleScope(auth);
  if (visible !== null && visible.length === 0) return ok([]);
  const properties = await prisma.property.findMany({ where: visible === null ? {} : { id: { in: visible } }, include: { organization: { select: { id: true, name: true, features: true } } }, orderBy: { createdAt: 'desc' }, take: 2000 });
  return ok(properties.map(property => ({ ...(auth.role === 'cleaner' ? { id: property.id, name: property.name, timezone: property.timezone } : property), operationalModules: OPERATIONAL_MODULES.filter(module => isModuleEnabled(module.key, property.organization?.features, property.featureOverrides)).map(module => module.key) })));
});

export const POST = withAuth('properties', async (req, { auth }) => {
  if (auth.role !== 'super_admin') throw fail(403, '지점 추가는 슈퍼매니저의 승인이 필요합니다. 설정에서 지점 추가를 요청해 주세요.');
  const body = await readJson(req);
  const name = str(body, 'name', { required: true, max: 100 })!.trim();
  const organizationId = str(body, 'organizationId') || null;
  if (organizationId && !(await prisma.organization.findFirst({ where: { id: organizationId, status: 'active' }, select: { id: true } }))) throw fail(400, '사용 중인 사업자를 선택해 주세요.');

  const property = await prisma.property.create({
    data: {
      name,
      organizationId,
      status: 'coming_soon',
      timezone: str(body, 'timezone', { max: 50 }) || 'Asia/Seoul',
      ownerId: auth.session.userId,
      beds24PropId: str(body, 'beds24PropId', { max: 50 }) ?? null,
      beds24RoomId: str(body, 'beds24RoomId', { max: 50 }) ?? null,
      doorPassword: str(body, 'doorPassword', { max: 50 }) ?? null,
      addressUrl: str(body, 'addressUrl', { max: 500 }) ?? null,
      roomReadyMessage: str(body, 'roomReadyMessage', { max: 2000 }) ?? null,
      basePrice: int(body, 'basePrice', { min: 0 }) ?? null,
      maxGuests: int(body, 'maxGuests', { min: 2, max: 10 }) ?? 2,
      description: str(body, 'description', { max: 4000 }) ?? null,
    },
  });

  // 매니저가 만든 숙소는 자기 배정 목록에 바로 들어간다 (관리자는 전체 접근이라 불필요하지만 무해).
  await prisma.userProperty.create({ data: { userId: auth.session.userId, propertyId: property.id } });
  return created(property);
});
