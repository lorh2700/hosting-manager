import { prisma } from '@/lib/prisma';

export interface AuditTarget { targetId?: string; propertyId?: string; organizationId?: string | null }

/** Only query resource identifiers and ownership. Never fetch audit content or credentials. */
export async function resolveAuditTarget(route: string, id: string): Promise<AuditTarget> {
  const resource = route.split('/')[0];
  if (resource === 'properties') return { propertyId: id };
  if (['users', 'staff', 'cleaners'].includes(resource)) {
    const user = await prisma.user.findUnique({ where: { id }, select: { organizationId: true } });
    return user ? { organizationId: user.organizationId } : {};
  }
  type PropertyLookup = { findUnique: (args: { where: { id: string }; select: { propertyId: true } }) => Promise<{ propertyId: string | null } | null> };
  const lookup = ({ cleanings: prisma.cleaning, 'cleaning-applications': prisma.cleaningApplication,
    bookings: prisma.booking, events: prisma.event, beds24: prisma.event, integrations: prisma.integration,
    'cleaning-issues': prisma.cleaningIssue, 'supply-requests': prisma.supplyRequest, 'supply-todos': prisma.supplyTodo,
    messages: prisma.message, laundry: prisma.laundryBatch, inventory: prisma.inventoryCountRecord,
    'guest-services': prisma.guestServiceRequest,
  } as unknown as Record<string, PropertyLookup>)[resource];
  if (lookup) {
    // Each of these resources has the same propertyId projection, although
    // Prisma delegates have different full model signatures.
    const target = await lookup.findUnique({ where: { id }, select: { propertyId: true } });
    return target?.propertyId ? { propertyId: target.propertyId } : {};
  }
  const ownerSelect = { owner: { select: { organizationId: true } } } as const;
  if (resource === 'tour-operators') {
    const operator = await prisma.tourOperator.findUnique({ where: { id }, select: ownerSelect });
    return operator?.owner ? { organizationId: operator.owner.organizationId } : {};
  }
  let tourId: string | undefined;
  if (resource === 'tour-bookings') {
    const booking = await prisma.tourBooking.findUnique({ where: { id }, select: { tourId: true } });
    tourId = booking?.tourId;
  } else if (resource === 'tours') tourId = id;
  if (tourId) {
    let tour = await prisma.tour.findUnique({ where: { id: tourId }, select: ownerSelect });
    if (!tour && resource === 'tours') {
      const child = route.includes('schedule') ? await prisma.tourSchedule.findUnique({ where: { id }, select: { tourId: true } })
        : route.includes('duration-options') ? await prisma.tourDurationOption.findUnique({ where: { id }, select: { tourId: true } })
        : route.includes('ticket-tiers') ? await prisma.tourTicketTier.findUnique({ where: { id }, select: { tourId: true } }) : null;
      if (child) tour = await prisma.tour.findUnique({ where: { id: child.tourId }, select: ownerSelect });
    }
    if (tour?.owner) return { organizationId: tour.owner.organizationId };
  }
  return {};
}
