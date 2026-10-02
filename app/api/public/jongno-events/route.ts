import { withErrors, ok } from '@/lib/core/http';
import { listJongnoEvents, readJongnoEventQuery } from '@/lib/jongno-events-store';

export const dynamic = 'force-dynamic';
export const GET = withErrors('public/jongno-events', async req => {
  const response = ok(await listJongnoEvents(readJongnoEventQuery(req, true), true));
  // Public editorial records only; no session-dependent data or reservation IDs.
  // Browser caching is brief so unpublishing/cancellation reaches guests quickly.
  response.headers.set('Cache-Control', 'public, max-age=30, s-maxage=60');
  return response;
});
