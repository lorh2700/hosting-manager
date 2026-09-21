import { runCameraInbox } from '@/lib/jobs/camera-inbox';
import { withErrors, ok, fail, cronOrSession, MESSAGES } from '@/lib/core/http';

export const maxDuration = 60;
export const POST = withErrors('cron/camera-inbox', async (req) => {
  const auth = await cronOrSession(req);
  if (auth && auth.role !== 'admin') throw fail(403, MESSAGES.forbidden);

  return ok(await runCameraInbox());
});
