import { withAuth, ok, created, readJson } from '@/lib/core/http';
import { listPropertyRequests, createPropertyRequest } from '@/lib/operations-settings-store';

export const dynamic = 'force-dynamic';
export const GET = withAuth('admin/property-requests', async (req, { auth }) => { const response = ok(await listPropertyRequests(auth, req)); response.headers.set('Cache-Control', 'private, no-store'); return response; }, { businessAdmin: true, audit: false });
export const POST = withAuth('admin/property-requests/create', async (req, { auth }) => created({ request: await createPropertyRequest(auth, await readJson(req)) }), { businessAdmin: true, audit: false });
