import { prisma } from '@/lib/prisma';
import { inquiryNotificationSettingsSchema, type InquiryRecipient } from '@/lib/inquiry-notification-settings';
import { getInquiryRecipientMembers } from '@/lib/inquiry-recipient-members';

/** Future inquiry escalation sender must resolve this at send time, so removals take effect. */
export async function getInquiryNotificationRecipients(propertyId: string): Promise<InquiryRecipient[]> {
  const settings = await prisma.inquiryNotificationSettings.findUnique({ where: { propertyId } });
  if (!settings?.enabled) return [];
  const parsed = inquiryNotificationSettingsSchema.safeParse({ enabled: settings.enabled, recipients: settings.recipients });
  // Invalid or missing configuration never falls back to an unrelated host/cleaner.
  if (!parsed.success) return [];
  const members = parsed.data.recipients.some(recipient => recipient.userId) ? await getInquiryRecipientMembers(propertyId) : [];
  const resolved = parsed.data.recipients.flatMap(recipient => {
    // Preserve existing manually configured recipients until the next settings save.
    if (!recipient.userId) return [recipient];
    const member = members.find(item => item.userId === recipient.userId && item.phone);
    return member ? [{ userId: member.userId, name: member.name, phone: member.phone }] : [];
  });
  return resolved.filter((recipient, index) => resolved.findIndex(item => item.phone === recipient.phone) === index);
}
