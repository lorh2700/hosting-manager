import { prisma } from '@/lib/prisma';
import { withAuth, ok } from '@/lib/core/http';

/**
 * Diagnostic — returns the current user's resolved cleaner state and what
 * each downstream API would consider "visible". Use while logged-in to figure
 * out why a cleaner-side page shows no data.
 */
export const GET = withAuth('debug/me', async (_req, { auth }) => {
  const cleanerByUserId = await prisma.cleaner.findUnique({
    where: { userId: auth.session.userId },
    select: { id: true, name: true, ownerId: true, userId: true, phone: true },
  });
  const cleanerByPhone = !cleanerByUserId && auth.user.phone
    ? await prisma.cleaner.findFirst({ where: { phone: auth.user.phone }, select: { id: true, name: true, ownerId: true, userId: true, phone: true } })
    : null;
  const myCleaner = cleanerByUserId ?? cleanerByPhone;

  const propertiesByOwner = myCleaner
    ? await prisma.property.findMany({ where: { ownerId: myCleaner.ownerId }, select: { id: true, name: true, ownerId: true } })
    : [];
  const userPropertyScope = await prisma.userProperty.findMany({ where: { userId: auth.session.userId }, select: { propertyId: true } });
  const totalProperties = await prisma.property.count();
  const cleaningsForOwner = myCleaner ? await prisma.cleaning.count({ where: { property: { ownerId: myCleaner.ownerId } } }) : 0;

  return ok({
    session: { userId: auth.session.userId, email: auth.session.email },
    user: { id: auth.user.id, email: auth.user.email, phone: auth.user.phone, role: auth.user.role, status: auth.user.status, displayName: auth.user.displayName },
    isAdmin: auth.isAdmin,
    cleanerLookup: { byUserId: cleanerByUserId, byPhone: cleanerByPhone, resolved: myCleaner },
    scope: {
      userPropertyScope: userPropertyScope.map(p => p.propertyId),
      ownerProperties: propertiesByOwner,
      totalPropertiesInDb: totalProperties,
      cleaningsCountForOwnerScope: cleaningsForOwner,
    },
    diagnosis: !myCleaner
      ? '⚠️ Cleaner row not found. Check that Cleaner.userId or Cleaner.phone matches this account.'
      : propertiesByOwner.length === 0
        ? `⚠️ No properties owned by this cleaner's host (ownerId=${myCleaner.ownerId}). Either no properties registered or Cleaner.ownerId is misconfigured.`
        : '✅ Cleaner properly linked. Cleaner pages should work.',
  });
});
