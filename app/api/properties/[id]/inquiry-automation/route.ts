import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, requireManage, readJson } from '@/lib/core/http';
import { getInquiryNotificationRecipients } from '@/lib/inquiry-notification-recipients';
import { inquiryDeliveryReadiness } from '@/lib/inquiry-delivery';

const schema = z.object({ enabled: z.boolean(), knowledge: z.string().trim().max(16000) }).strict();
type Params = { id: string };

export const GET = withAuth<Params>('inquiry-automation/settings', async (_req, { auth, params }) => {
  requireManage(auth, params.id);
  const property = await prisma.property.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!property) throw fail(404, '숙소를 찾을 수 없습니다.');
  const config = await prisma.inquiryAutomationSettings.findUnique({ where: { propertyId: params.id } });
  return ok({ enabled: config?.enabled ?? false, knowledge: config?.knowledge ?? '', missing: inquiryDeliveryReadiness() });
});

export const PUT = withAuth<Params>('inquiry-automation/settings', async (req, { auth, params }) => {
  requireManage(auth, params.id);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw fail(400, '자동답변 사용 여부와 숙소 안내문(최대 16,000자)을 확인해 주세요.');
  const property = await prisma.property.findUnique({ where: { id: params.id }, select: { beds24PropId: true } });
  if (!property) throw fail(404, '숙소를 찾을 수 없습니다.');
  if (parsed.data.enabled) {
    if (!property.beds24PropId) throw fail(400, 'Beds24 숙소를 먼저 연결해 주세요.');
    if (parsed.data.knowledge.length < 30) throw fail(400, '자동답변에 사용할 숙소 안내문을 30자 이상 입력해 주세요.');
    if (!(await getInquiryNotificationRecipients(params.id)).length) throw fail(400, '고객 문의 알림을 켜고 수신자를 먼저 저장해 주세요.');
    const missing = inquiryDeliveryReadiness();
    if (missing.length) throw fail(400, `${missing.join(', ')} 설정이 필요합니다.`);
  }
  const previous = await prisma.inquiryAutomationSettings.findUnique({ where: { propertyId: params.id } });
  const data = { ...parsed.data, enabledAt: parsed.data.enabled ? (previous?.enabled ? previous.enabledAt : new Date()) : null };
  const config = await prisma.inquiryAutomationSettings.upsert({ where: { propertyId: params.id }, create: { propertyId: params.id, ...data }, update: data });
  return ok({ enabled: config.enabled, knowledge: config.knowledge, missing: inquiryDeliveryReadiness() });
});
