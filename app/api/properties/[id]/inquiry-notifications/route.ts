import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, requireManage, readJson } from '@/lib/core/http';
import { inquiryNotificationSettingsSchema } from '@/lib/inquiry-notification-settings';

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
  return ok({ enabled: settings?.enabled ?? false, recipients: settings?.recipients ?? [] });
});

export const PUT = withAuth<Params>('properties/inquiry-notifications', async (req, { auth, params }) => {
  requireManage(auth, params.id);
  await requireProperty(params.id);
  const parsed = inquiryNotificationSettingsSchema.safeParse(await readJson(req));
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
