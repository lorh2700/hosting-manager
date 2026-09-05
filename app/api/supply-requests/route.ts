import { prisma } from '@/lib/prisma';
import {
  withAuth, ok, created, fail, MESSAGES,
  requireManage, requireVisible, visibleScope, readJson, str, idList, query,
} from '@/lib/core/http';

export const GET = withAuth('supply-requests', async (req, { auth }) => {
  const where: Record<string, unknown> = {};
  // 청소매니저는 자기 호스트의 숙소 요청을, 호스트는 담당 숙소 요청을 본다.
  const visible = await visibleScope(auth, idList(req, 'propertyIds'));
  if (visible !== null) {
    if (visible.length === 0) return ok([]);
    where.propertyId = { in: visible };
  }
  const status = query(req, 'status');
  if (status) where.status = status;
  return ok(await prisma.supplyRequest.findMany({ where, orderBy: { createdAt: 'desc' } }));
});

export const POST = withAuth('supply-requests', async (req, { auth }) => {
  const body = await readJson(req);
  const propertyId = str(body, 'propertyId', { required: true })!;
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw fail(400, 'items 배열에 최소 1개 이상의 품목이 필요합니다.');
  }
  // 청소매니저도 자기가 청소하는 숙소에는 요청을 올릴 수 있다.
  await requireVisible(auth, propertyId);

  // Whitelist fields (prevent mass-assignment + drop unknown fields).
  const request = await prisma.supplyRequest.create({
    data: {
      propertyId,
      requestedBy: auth.session.userId,                  // always trust session
      requestedByName: str(body, 'requestedByName', { max: 100 }) ?? null,
      items: body.items,
      urgency: str(body, 'urgency', { max: 20 }) ?? 'normal',
      status: 'pending',                                 // always start as pending
      statusNote: str(body, 'statusNote', { max: 1000 }) ?? null,
    },
  });
  return created(request);
});

export const PUT = withAuth('supply-requests', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;
  const existing = await prisma.supplyRequest.findUnique({ where: { id }, select: { propertyId: true } });
  if (!existing) throw fail(404, MESSAGES.notFound);
  // 처리 상태 변경은 호스트/관리자만.
  requireManage(auth, existing.propertyId);

  const data: { status?: string; statusNote?: string | null; urgency?: string } = {};
  const status = str(body, 'status', { max: 20 }); if (status !== undefined) data.status = status;
  if (body.statusNote !== undefined) data.statusNote = typeof body.statusNote === 'string' ? body.statusNote : null;
  const urgency = str(body, 'urgency', { max: 20 }); if (urgency !== undefined) data.urgency = urgency;
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);

  return ok(await prisma.supplyRequest.update({ where: { id }, data }));
});
