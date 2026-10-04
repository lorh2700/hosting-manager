import { withAuth, ok, created, readJson } from '@/lib/core/http';
import { listOrganizations, createOrganization } from '@/lib/operations-settings-store';

export const dynamic = 'force-dynamic';
export const GET = withAuth('admin/organizations', async (req, { auth }) => {
  const organizations = await listOrganizations(auth, req); const response = ok({ organizations }); response.headers.set('Cache-Control', 'private, no-store'); return response;
}, { businessAdmin: true, audit: false });
export const POST = withAuth('admin/organizations/create', async (req, { auth }) => created({ organization: await createOrganization(auth, await readJson(req)) }), { admin: true, audit: false });
