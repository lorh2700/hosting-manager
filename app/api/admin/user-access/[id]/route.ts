import { withAuth, ok, readJson } from '@/lib/core/http';
import { updateUserAccess } from '@/lib/operations-settings-store';

export const PATCH = withAuth<{ id: string }>('admin/user-access/update', async (req, { auth, params }) => ok({ user: await updateUserAccess(auth, params.id, await readJson(req)) }), { businessAdmin: true, audit: false });
