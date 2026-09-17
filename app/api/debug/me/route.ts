import { withAuth, ok } from '@/lib/core/http';
export const GET = withAuth('debug/me', async (_req, { auth }) => ok({ userId: auth.session.userId, role: auth.role, propertyIds: auth.propertyIds }));
