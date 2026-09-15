import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, requireManage, readJson } from '@/lib/core/http';
import { setInquiryPaused } from '@/lib/inquiry-conversation';

type Params = { id: string };
export const GET = withAuth<Params>('inquiry-automation/conversation', async (_req, { auth, params }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id }, select: { propertyId: true } });
  if (!event) throw fail(404, '예약 대화를 찾을 수 없습니다.');
  requireManage(auth, event.propertyId);
  const [state, settings, jobs] = await Promise.all([
    prisma.inquiryConversation.findUnique({ where: { eventId: params.id } }),
    prisma.inquiryAutomationSettings.findUnique({ where: { propertyId: event.propertyId } }),
    prisma.inquiryJob.findMany({ where: { eventId: params.id }, orderBy: { createdAt: 'desc' }, take: 5,
      select: { messageId: true, status: true, summary: true, reason: true, draft: true, createdAt: true,
        notifications: { select: { name: true, status: true, error: true } } } }),
  ]);
  return ok({ enabled: settings?.enabled ?? false, paused: state?.paused ?? false, reason: state?.reason ?? null, jobs });
});

export const PUT = withAuth<Params>('inquiry-automation/conversation', async (req, { auth, params }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id }, select: { propertyId: true } });
  if (!event) throw fail(404, '예약 대화를 찾을 수 없습니다.');
  requireManage(auth, event.propertyId);
  const parsed = z.object({ paused: z.boolean() }).strict().safeParse(await readJson(req));
  if (!parsed.success) throw fail(400, '담당자 응대 상태를 확인해 주세요.');
  await setInquiryPaused(params.id, parsed.data.paused);
  return ok({ paused: parsed.data.paused });
});
