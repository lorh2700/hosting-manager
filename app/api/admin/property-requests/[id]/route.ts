import { withAuth, ok, readJson } from '@/lib/core/http';
import { decidePropertyRequest } from '@/lib/operations-settings-store';

export const PATCH = withAuth<{ id: string }>('admin/property-requests/decide', async (req, { auth, params }) => ok({ request: await decidePropertyRequest(auth, params.id, await readJson(req)) }), { admin: true, audit: false });
