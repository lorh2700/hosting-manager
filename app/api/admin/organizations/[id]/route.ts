import { withAuth, ok, readJson } from '@/lib/core/http';
import { updateOrganization } from '@/lib/operations-settings-store';

export const PATCH = withAuth<{ id: string }>('admin/organizations/update', async (req, { auth, params }) => ok({ organization: await updateOrganization(auth, params.id, await readJson(req)) }), { admin: true, audit: false });
