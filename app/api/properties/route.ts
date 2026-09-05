import { prisma } from '@/lib/prisma';
import { withAuth, ok, created, readJson, str, int } from '@/lib/core/http';

export const GET = withAuth('properties', async (_req, { auth }) => {
  if (auth.isAdmin) return ok(await prisma.property.findMany({ orderBy: { createdAt: 'desc' } }));

  // Resolve a Cleaner record using userId, then phone. Treat the user as a cleaner
  // if EITHER role='cleaner' OR a Cleaner row exists (legacy accounts with a mis-set role).
  let myCleaner = await prisma.cleaner.findUnique({ where: { userId: auth.session.userId }, select: { ownerId: true } });
  if (!myCleaner && auth.user.phone) {
    myCleaner = await prisma.cleaner.findFirst({ where: { phone: auth.user.phone }, select: { ownerId: true } });
  }
  const isCleaner = auth.user.role === 'cleaner' || !!myCleaner;
  const userPropScope = auth.propertyIds ?? [];

  if (isCleaner) {
    if (myCleaner) {
      // Primary: every property of the cleaner's host.
      const ownerProps = await prisma.property.findMany({ where: { ownerId: myCleaner.ownerId }, orderBy: { createdAt: 'desc' } });
      if (ownerProps.length > 0) return ok(ownerProps);
      // Fallback: Cleaner.ownerId points to a host with no properties → UserProperty scope.
      if (userPropScope.length > 0) {
        return ok(await prisma.property.findMany({ where: { id: { in: userPropScope } }, orderBy: { createdAt: 'desc' } }));
      }
    }
    // No Cleaner row at all → scope if any, else every property so the cleaner pages have data.
    if (userPropScope.length > 0) {
      return ok(await prisma.property.findMany({ where: { id: { in: userPropScope } }, orderBy: { createdAt: 'desc' } }));
    }
    return ok(await prisma.property.findMany({ orderBy: { createdAt: 'desc' } }));
  }

  if (userPropScope.length === 0) return ok([]);
  return ok(await prisma.property.findMany({ where: { id: { in: userPropScope } }, orderBy: { createdAt: 'desc' } }));
});

export const POST = withAuth('properties', async (req, { auth }) => {
  const body = await readJson(req);
  const name = str(body, 'name', { required: true, max: 100 })!.trim();

  const property = await prisma.property.create({
    data: {
      name,
      timezone: str(body, 'timezone', { max: 50 }) || 'Asia/Seoul',
      ownerId: auth.session.userId,
      beds24PropId: str(body, 'beds24PropId', { max: 50 }) ?? null,
      beds24RoomId: str(body, 'beds24RoomId', { max: 50 }) ?? null,
      doorPassword: str(body, 'doorPassword', { max: 50 }) ?? null,
      addressUrl: str(body, 'addressUrl', { max: 500 }) ?? null,
      roomReadyMessage: str(body, 'roomReadyMessage', { max: 2000 }) ?? null,
      basePrice: int(body, 'basePrice', { min: 0 }) ?? null,
      maxGuests: int(body, 'maxGuests', { min: 1, max: 100 }) ?? null,
      description: str(body, 'description', { max: 4000 }) ?? null,
    },
  });

  await prisma.userProperty.create({ data: { userId: auth.session.userId, propertyId: property.id } });
  return created(property);
});
