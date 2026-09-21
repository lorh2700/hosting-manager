import { runBeds24Sync } from '@/lib/jobs/beds24-sync';
import { withErrors, ok, fail, MESSAGES, cronOrSession } from '@/lib/core/http';

export const maxDuration = 60;
export const POST = withErrors('beds24/sync-all', async (req) => {
  const auth = await cronOrSession(req);
  if (auth && !auth.isAdmin) throw fail(403, MESSAGES.forbidden);

  return ok(await runBeds24Sync());
});
