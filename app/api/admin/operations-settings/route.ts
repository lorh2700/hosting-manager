import { withAuth, ok, readJson } from '@/lib/core/http';
import { getOperationsSettings, updateOperationsSettings } from '@/lib/operations-settings-store';

export const dynamic = 'force-dynamic';
export const GET = withAuth('admin/operations-settings', async (req, { auth }) => {
  const response = ok(await getOperationsSettings(auth, req)); response.headers.set('Cache-Control', 'private, no-store'); return response;
}, { businessAdmin: true, audit: false });
export const PUT = withAuth('admin/operations-settings/update', async (req, { auth }) => ok(await updateOperationsSettings(auth, await readJson(req))), { businessAdmin: true, audit: false });
