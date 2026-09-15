import { prisma } from '@/lib/prisma';
import { inquiryNotificationSettingsSchema, type InquiryRecipient } from '@/lib/inquiry-notification-settings';

/** Future inquiry escalation sender must resolve this at send time, so removals take effect. */
export async function getInquiryNotificationRecipients(propertyId: string): Promise<InquiryRecipient[]> {
  const settings = await prisma.inquiryNotificationSettings.findUnique({ where: { propertyId } });
  if (!settings?.enabled) return [];
  const parsed = inquiryNotificationSettingsSchema.safeParse({ enabled: settings.enabled, recipients: settings.recipients });
  // Invalid or missing configuration never falls back to an unrelated host/cleaner.
  return parsed.success ? parsed.data.recipients : [];
}
