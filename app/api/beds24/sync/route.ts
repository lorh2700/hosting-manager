import { prisma } from '@/lib/prisma';
import { syncBeds24Property } from '@/lib/sync-engine';
import { withAuth, ok, fail, requireManage, readJson, str } from '@/lib/core/http';

/**
 * 숙소 한 곳의 Beds24 동기화 (숙소 페이지의 동기화 버튼).
 * beds24PropId 는 body 가 아니라 DB 의 숙소 설정에서 가져온다 — 임의의 Beds24
 * 숙소 예약을 다른 숙소에 흘려 넣는 것을 막기 위해서.
 */
export const POST = withAuth('beds24/sync', async (req, { auth }) => {
  const body = await readJson(req);
  const propertyId = str(body, 'propertyId', { required: true })!;
  requireManage(auth, propertyId);

  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { beds24PropId: true } });
  if (!property) throw fail(404, '숙소를 찾을 수 없습니다.');
  if (!property.beds24PropId) throw fail(400, '이 숙소에는 Beds24 연동이 설정되어 있지 않습니다.');

  const result = await syncBeds24Property(propertyId, property.beds24PropId);
  if (result.error) throw fail(502, result.error);

  return ok({
    success: true,
    total: result.total,
    eventsCreated: result.eventsCreated,
    eventsUpdated: result.eventsUpdated,
    eventsRemoved: result.eventsRemoved,
  });
});
