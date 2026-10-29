import { runCameraInbox } from '../../lib/jobs/camera-inbox';
import { legacyBackgroundJobsEnabled } from '../../lib/jobs/background-controls';

export default async (req: Request) => {
  if (!legacyBackgroundJobsEnabled()) return new Response('Disabled', { status: 200 });
  if (!process.env.CRON_SECRET || req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) return new Response('Unauthorized', { status: 401 });
  const result = await runCameraInbox();
  console.log('camera-inbox completed', JSON.stringify(result));
  return Response.json(result);
};
