import type { Prisma, JongnoEvent } from '../../generated/prisma/client';
import type { JongnoEventDTO } from '../../lib/jongno-events';

export type PeopleEventsDatabase = Pick<Prisma.TransactionClient, 'user' | 'userProperty' | 'property' | 'organization' | 'jongnoEvent' | 'auditLog' | 'invitation'>;
export const staffSelect = {
  id: true, email: true, displayName: true, phone: true, role: true, status: true, ownerId: true,
  organizationId: true, accessVersion: true, password: true, publicToken: true,
  organization: { select: { id: true, name: true } },
  properties: { select: { propertyId: true, property: { select: { id: true, name: true, organizationId: true } } }, orderBy: { propertyId: 'asc' as const }, take: 201 },
} satisfies Prisma.UserSelect;
export type StaffRow = Prisma.UserGetPayload<{ select: typeof staffSelect }>;

export function createPeopleEventsRepository(database: PeopleEventsDatabase) {
  return {
    staff: (where: Prisma.UserWhereInput, take: number) => database.user.findMany({ where, select: staffSelect, orderBy: { id: 'asc' }, take }),
    staffById: (id: string) => database.user.findUnique({ where: { id }, select: staffSelect }),
    properties: (where: Prisma.PropertyWhereInput) => database.property.findMany({ where,
      select: { id: true, name: true, organizationId: true, featureOverrides: true, organization: { select: { id: true, status: true, features: true } } },
      orderBy: { name: 'asc' }, take: 201 }),
  };
}

export function eventDto(row: JongnoEvent): JongnoEventDTO {
  return { id: row.id, titleKo: row.titleKo, titleEn: row.titleEn, descriptionKo: row.descriptionKo, descriptionEn: row.descriptionEn,
    category: row.category as JongnoEventDTO['category'], area: row.area as JongnoEventDTO['area'], venue: row.venue, address: row.address,
    startDate: row.startDate, endDate: row.endDate, timeText: row.timeText, excludedWeekdays: row.excludedWeekdays as number[], excludedDates: row.excludedDates as string[],
    feeType: row.feeType as JongnoEventDTO['feeType'], feeText: row.feeText, bookingRequired: row.bookingRequired, officialUrl: row.officialUrl,
    bookingUrl: row.bookingUrl, mapUrl: row.mapUrl, languageText: row.languageText, images: row.images as unknown as JongnoEventDTO['images'],
    status: row.status as JongnoEventDTO['status'], verifiedAt: row.verifiedAt?.toISOString() ?? null, version: row.version, updatedAt: row.updatedAt.toISOString() };
}
