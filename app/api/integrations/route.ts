import { prisma } from '@/lib/prisma';
import { withAuth, ok, created, fail, MESSAGES, requireOwnerOrAdmin, requireVisible, readJson, str, int, query, requireQuery } from '@/lib/core/http';
import type { IntegrationProvider, IntegrationType } from '@/lib/types';

export const GET = withAuth('integrations', async (req, { auth }) => {
  const propertyId = query(req, 'propertyId');
  if (propertyId) {
    // 담당 숙소가 아니면 연동 설정(iCal URL 등)을 볼 수 없다.
    await requireVisible(auth, propertyId);
    return ok(await prisma.integration.findMany({ where: { propertyId } }));
  }
  if (auth.isAdmin) return ok(await prisma.integration.findMany());
  const propIds = auth.propertyIds ?? [];
  if (propIds.length === 0) return ok([]);
  return ok(await prisma.integration.findMany({ where: { propertyId: { in: propIds } } }));
});

// 연동 생성·수정·삭제는 숙소 소유자 또는 관리자만 (iCal URL 이 예약 데이터 원본이므로).
export const POST = withAuth('integrations', async (req, { auth }) => {
  const body = await readJson(req);
  const propertyId = str(body, 'propertyId', { required: true })!;
  const provider = str(body, 'provider', { required: true, max: 50 })! as IntegrationProvider;
  const type = str(body, 'type', { required: true, max: 30 })! as IntegrationType;

  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } });
  if (!property) throw fail(404, '숙소를 찾을 수 없습니다.');
  await requireOwnerOrAdmin(auth, propertyId);

  const integration = await prisma.integration.create({
    data: {
      propertyId,
      provider,
      type,
      config: (body.config as Record<string, string> | undefined) ?? {},
      status: 'active',
      syncIntervalMinutes: int(body, 'syncIntervalMinutes', { min: 1, max: 1440 }) ?? 15,
    },
  });
  return created(integration);
});

const UPDATABLE = ['config', 'status', 'syncIntervalMinutes', 'lastSyncAt', 'lastSyncStatus', 'lastErrorMessage'];

export const PUT = withAuth('integrations', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;
  const integ = await prisma.integration.findUnique({ where: { id }, select: { propertyId: true } });
  if (!integ) throw fail(404, '연동을 찾을 수 없습니다.');
  await requireOwnerOrAdmin(auth, integ.propertyId);

  const data: Record<string, unknown> = {};
  for (const key of UPDATABLE) if (key in body) data[key] = body[key];
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);
  return ok(await prisma.integration.update({ where: { id }, data }));
});

export const DELETE = withAuth('integrations', async (req, { auth }) => {
  const id = requireQuery(req, 'id');
  const integ = await prisma.integration.findUnique({ where: { id }, select: { propertyId: true } });
  if (!integ) throw fail(404, '연동을 찾을 수 없습니다.');
  await requireOwnerOrAdmin(auth, integ.propertyId);

  await prisma.integration.delete({ where: { id } });
  return ok({ success: true });
});
