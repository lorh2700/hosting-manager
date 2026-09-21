import { runCameraInbox } from '../../lib/jobs/camera-inbox';

export default async (req: Request) => {
  if (!process.env.CRON_SECRET || req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) return new Response('Unauthorized', { status: 401 });
  const result = await runCameraInbox();
  console.log('camera-inbox completed', JSON.stringify(result));
  return Response.json(result);
};
