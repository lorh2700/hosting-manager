import { withAuth, created, ok, readJson } from '@/lib/core/http';
import { createJongnoEvent, listJongnoEvents, readJongnoEventInput, readJongnoEventQuery } from '@/lib/jongno-events-store';

export const dynamic = 'force-dynamic';
export const GET = withAuth('admin/jongno-events', async req => {
  const response = ok(await listJongnoEvents(readJongnoEventQuery(req, false), false));
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}, { admin: true });
export const POST = withAuth('admin/jongno-events/create', async (req, { auth }) => {
  const input = readJongnoEventInput(await readJson(req));
  return created({ event: await createJongnoEvent(input, auth.user.id) });
}, { admin: true });
