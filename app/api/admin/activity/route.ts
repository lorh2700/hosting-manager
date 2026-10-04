import { withAuth, ok } from '@/lib/core/http';
import { listActivity } from '@/lib/operations-settings-store';

export const dynamic = 'force-dynamic';
export const GET = withAuth('admin/activity', async (req, { auth }) => {
  const response = ok(await listActivity(auth, req)); response.headers.set('Cache-Control', 'private, no-store'); return response;
}, { businessAdmin: true, audit: false });
