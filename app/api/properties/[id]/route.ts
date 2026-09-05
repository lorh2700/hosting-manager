import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, MESSAGES, requireManage, requireOwnerOrAdmin, requireVisible, readJson } from '@/lib/core/http';

type Params = { id: string };

const ALLOWED_FIELDS = ['name', 'timezone', 'beds24PropId', 'beds24RoomId', 'doorPassword', 'addressUrl', 'roomReadyMessage', 'basePrice', 'maxGuests', 'description'];

// 읽기는 청소매니저도 자기 호스트의 숙소라면 허용 (도어코드·주소 안내용).
export const GET = withAuth<Params>('properties/id', async (_req, { auth, params }) => {
  await requireVisible(auth, params.id);
  const property = await prisma.property.findUnique({ where: { id: params.id }, include: { channels: true } });
  if (!property) throw fail(404, MESSAGES.notFound);
  return ok(property);
});

export const PUT = withAuth<Params>('properties/id', async (req, { auth, params }) => {
  requireManage(auth, params.id);
  const body = await readJson(req);
  const data: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) if (key in body) data[key] = body[key];
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);
  return ok(await prisma.property.update({ where: { id: params.id }, data }));
});

// 숙소 삭제는 예약·청소·메시지까지 연쇄 삭제되므로 소유자 또는 관리자만.
export const DELETE = withAuth<Params>('properties/id', async (_req, { auth, params }) => {
  await requireOwnerOrAdmin(auth, params.id);
  await prisma.property.delete({ where: { id: params.id } });
  return ok({ success: true });
});
