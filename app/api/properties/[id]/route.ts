import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, MESSAGES, requireManage, requireOwnerOrAdmin, requireVisible, readJson } from '@/lib/core/http';
import { z } from 'zod';
import { propertyPublicInfo, publicInfoSchema, publishRequirements } from '@/lib/property-public-info';

type Params = { id: string };

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const fields = z.object({ name: z.string().trim().min(1).max(120).optional(), timezone: z.string().max(80).optional(), beds24PropId: optionalText(80), beds24RoomId: optionalText(80), doorPassword: optionalText(200), addressUrl: optionalText(2000), roomReadyMessage: optionalText(10000), basePrice: z.number().nonnegative().nullable().optional(), maxGuests: z.number().int().min(2).max(10).nullable().optional(), description: optionalText(12000), cameraName: optionalText(200), cameraNotes: optionalText(2000), slug: z.string().trim().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(), status: z.enum(['active', 'coming_soon', 'closed']).optional(), openingDate: optionalText(80), publicInfo: publicInfoSchema.optional() });

// 읽기는 청소매니저도 자기 호스트의 숙소라면 허용 (도어코드·주소 안내용).
export const GET = withAuth<Params>('properties/id', async (_req, { auth, params }) => {
  await requireVisible(auth, params.id);
  const property = await prisma.property.findUnique({ where: { id: params.id }, include: { channels: true } });
  if (!property) throw fail(404, MESSAGES.notFound);
  return ok({ ...property, publicInfo: propertyPublicInfo(property), publishMissing: publishRequirements(property) });
});

export const PUT = withAuth<Params>('properties/id', async (req, { auth, params }) => {
  requireManage(auth, params.id);
  const body = await readJson(req);
  const parsed = fields.safeParse(body);
  if (!parsed.success) throw fail(400, parsed.error.issues[0]?.message || '숙소 설정값을 확인해 주세요.');
  const data = parsed.data;
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);
  const current = await prisma.property.findUnique({ where: { id: params.id } });
  if (!current) throw fail(404, MESSAGES.notFound);
  if (data.slug && data.slug !== current.slug && current.status === 'active') throw fail(409, '공개 중인 숙소의 주소를 변경하려면 먼저 공개를 중지해 주세요.');
  if ((data.status ?? current.status) === 'active' && (current.status !== 'active' || publishRequirements(current).length === 0)) {
    const missing = publishRequirements({ ...current, ...data });
    if (missing.length) throw fail(400, `공개 전에 다음 정보를 입력해 주세요: ${missing.join(', ')}`, { publishMissing: missing });
  }
  const saved = await prisma.property.update({ where: { id: params.id }, data }).catch(error => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw fail(409, '이미 사용 중인 숙소 주소입니다. 다른 주소를 입력해 주세요.');
    throw error;
  });
  return ok({ ...saved, publicInfo: propertyPublicInfo(saved), publishMissing: publishRequirements(saved) });
});

// 숙소 삭제는 예약·청소·메시지까지 연쇄 삭제되므로 소유자 또는 관리자만.
export const DELETE = withAuth<Params>('properties/id', async (_req, { auth, params }) => {
  await requireOwnerOrAdmin(auth, params.id);
  await prisma.property.delete({ where: { id: params.id } });
  return ok({ success: true });
});
