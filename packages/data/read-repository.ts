import type { Prisma, PrismaClient } from '../../generated/prisma/client';

const propertySelect = {
  id: true, name: true, timezone: true, organizationId: true, status: true,
  featureOverrides: true, featureVersion: true,
  organization: { select: { id: true, name: true, status: true, features: true } },
} as const satisfies Prisma.PropertySelect;

const eventSelect = {
  id: true, propertyId: true, channelId: true, source: true, title: true,
  startDate: true, endDate: true, type: true, originalUid: true, numAdults: true, numChildren: true,
} as const satisfies Prisma.EventSelect;

const bookingSelect = {
  id: true, propertyId: true, name: true, checkIn: true, checkOut: true, guests: true,
  source: true, channelBookingRef: true, checkout: { select: { beds24Id: true, stayOptions: true } },
} as const satisfies Prisma.BookingSelect;

const cleaningSelect = {
  id: true, propertyId: true, date: true, status: true, cleanerId: true, origin: true,
  externalCleanerName: true, cleaner: { select: { displayName: true } },
} as const satisfies Prisma.CleaningSelect;

export class BackendReadSnapshot {
  private readonly tx: Prisma.TransactionClient;
  constructor(tx: Prisma.TransactionClient) { this.tx = tx; }

  properties(where: Prisma.PropertyWhereInput, take: number) {
    return this.tx.property.findMany({ where, select: propertySelect, orderBy: [{ name: 'asc' }, { id: 'asc' }], take });
  }

  events(where: Prisma.EventWhereInput, take: number) {
    return this.tx.event.findMany({ where, select: eventSelect, orderBy: [{ startDate: 'asc' }, { id: 'asc' }], take });
  }

  bookings(where: Prisma.BookingWhereInput, take: number) {
    return this.tx.booking.findMany({ where, select: bookingSelect, orderBy: [{ checkIn: 'asc' }, { id: 'asc' }], take });
  }

  cleanings(where: Prisma.CleaningWhereInput, take: number) {
    return this.tx.cleaning.findMany({ where, select: cleaningSelect, orderBy: [{ date: 'asc' }, { id: 'asc' }], take });
  }

  staff(where: Prisma.UserWhereInput, propertyWhere: Prisma.PropertyWhereInput, take: number) {
    return this.tx.user.findMany({ where, take, orderBy: { id: 'asc' }, select: {
      id: true, displayName: true, email: true, role: true, status: true, organizationId: true,
      organization: { select: { id: true, name: true } },
      properties: { where: { property: propertyWhere }, select: { property: { select: { id: true, name: true } } },
        orderBy: { propertyId: 'asc' }, take: 21 },
    } });
  }
}

export class PrismaBackendReadRepository {
  private readonly db: Pick<PrismaClient, '$transaction'>;
  constructor(db: Pick<PrismaClient, '$transaction'>) { this.db = db; }

  snapshot<T>(read: (snapshot: BackendReadSnapshot) => Promise<T>): Promise<T> {
    return this.db.$transaction(tx => read(new BackendReadSnapshot(tx)), {
      isolationLevel: 'RepeatableRead', maxWait: 5_000, timeout: 10_000,
    });
  }
}
