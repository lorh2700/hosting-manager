import { staffDirectory } from '@/lib/staff-directory';
import { prisma } from '@/lib/prisma';
import { withAuth, ok } from '@/lib/core/http';

export const GET = withAuth('cleaners/me', async (_req, { auth }) => {
  const cleaner = await staffDirectory.findUnique({ where: { userId: auth.session.userId } });
  return ok({ cleaner: cleaner ?? null });
});
