import { withAuth, created, readJson } from '@/lib/core/http';
import { inviteBusinessAdministrator } from '@/lib/operations-settings-store';

export const POST = withAuth<{ id: string }>('admin/organizations/invite', async (req, { auth, params }) => {
  const configured = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  const origin = configured ? new URL(configured).origin : new URL(req.url).origin;
  return created(await inviteBusinessAdministrator(auth, params.id, await readJson(req), origin));
}, { admin: true, audit: false });
