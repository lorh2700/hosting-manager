import { runBeds24Sync } from '../../lib/jobs/beds24-sync';
import { legacyBackgroundJobsEnabled } from '../../lib/jobs/background-controls';

export default async (req: Request) => {
  if (!legacyBackgroundJobsEnabled()) return new Response('Disabled', { status: 200 });
  if (!process.env.CRON_SECRET || req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) return new Response('Unauthorized', { status: 401 });
  const result = await runBeds24Sync();
  console.log('beds24-sync completed', JSON.stringify(result));
  return Response.json(result);
};
