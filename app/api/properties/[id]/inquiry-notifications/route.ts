import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, requireManage, readJson } from '@/lib/core/http';
import { inquiryNotificationSettingsSchema } from '@/lib/inquiry-notification-settings';
import { getInquiryRecipientMembers } from '@/lib/inquiry-recipient-members';
import { z } from 'zod';

const memberSettingsSchema = z.object({ enabled: z.boolean(), recipients: z.array(z.object({ userId: z.string().min(1) }).strict()).max(10) }).strict();

type Params = { id: string };

async function requireProperty(id: string) {
  const property = await prisma.property.findUnique({ where: { id }, select: { id: true } });
  if (!property) throw fail(404, '숙소를 찾을 수 없습니다.');
}

export const GET = withAuth<Params>('properties/inquiry-notifications', async (_req, { auth, params }) => {
  // Contact details are not exposed to accounts with read-only property access.
  requireManage(auth, params.id);
  await requireProperty(params.id);
  const settings = await prisma.inquiryNotificationSettings.findUnique({ where: { propertyId: params.id } });
  return ok({ enabled: settings?.enabled ?? false, recipients: settings?.recipients ?? [], members: await getInquiryRecipientMembers(params.id) });
});

export const PUT = withAuth<Params>('properties/inquiry-notifications', async (req, { auth, params }) => {
  requireManage(auth, params.id);
  await requireProperty(params.id);
  const selection = memberSettingsSchema.safeParse(await readJson(req));
  if (!selection.success) throw fail(400, '등록된 회원을 수신자로 선택해 주세요.');
  const members = await getInquiryRecipientMembers(params.id);
  const recipients = selection.data.recipients.map(({ userId }) => {
    const member = members.find(item => item.userId === userId);
    if (!member) throw fail(400, '이 숙소를 관리할 수 있는 활성 회원을 선택해 주세요.');
    if (!member.phone) throw fail(400, `${member.name}님의 휴대폰 번호를 먼저 등록해 주세요.`);
    return { userId, name: member.name, phone: member.phone };
  });
  const parsed = inquiryNotificationSettingsSchema.safeParse({ enabled: selection.data.enabled, recipients });
  if (!parsed.success) throw fail(400, parsed.error.issues[0]?.message ?? '수신자 설정을 확인해 주세요.');
  const settings = await prisma.$transaction(async tx => {
  const saved = await tx.inquiryNotificationSettings.upsert({
    where: { propertyId: params.id },
    create: { propertyId: params.id, ...parsed.data },
    update: parsed.data,
  });
  if (!parsed.data.enabled) await tx.inquiryAutomationSettings.updateMany({ where: { propertyId: params.id }, data: { enabled: false, enabledAt: null } });
  return saved;
  });
  return ok({ enabled: settings.enabled, recipients: settings.recipients });
});
