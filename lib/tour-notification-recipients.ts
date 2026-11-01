import { prisma } from '@/lib/prisma';
import { normalizePhone } from '@/lib/phone';
import { getInquiryNotificationRecipients } from '@/lib/inquiry-notification-recipients';
import { phoneSchema, type InquiryRecipient } from '@/lib/inquiry-notification-settings';

type Tour = {
  organizationId: string | null;
  owner: { organizationId: string | null; phone: string | null; displayName: string | null; email: string };
};

async function configuredRecipient(organizationId: string | null): Promise<InquiryRecipient | null | undefined> {
  if (!organizationId) return undefined;
  const settings = await prisma.tourNotificationSettings.findUnique({ where: { organizationId }, select: { phone: true } });
  if (!settings) return undefined;
  const parsed = phoneSchema.safeParse(settings.phone);
  return parsed.success ? { name: '투어 담당자', phone: parsed.data } : null;
}

export async function getTourNotificationRecipient(tour: Tour): Promise<InquiryRecipient | null> {
  const recipient = await configuredRecipient(tour.organizationId ?? tour.owner.organizationId);
  if (recipient !== undefined) return recipient;
  if (tour.organizationId && tour.organizationId !== tour.owner.organizationId) return null;
  const phone = normalizePhone(tour.owner.phone);
  return phone ? { name: tour.owner.displayName ?? tour.owner.email, phone } : null;
}

export async function getGuestStayTourNotificationRecipients(propertyId: string): Promise<InquiryRecipient[]> {
  const property = await prisma.property.findUnique({ where: { id: propertyId },
    select: { organizationId: true, owner: { select: { organizationId: true } } } });
  if (!property) return [];
  const recipient = await configuredRecipient(property.organizationId ?? property.owner?.organizationId ?? null);
  if (recipient !== undefined) return recipient ? [recipient] : [];
  return getInquiryNotificationRecipients(propertyId);
}
