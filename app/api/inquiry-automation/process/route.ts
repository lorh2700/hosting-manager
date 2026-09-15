import { withErrors, ok, fail, isCronRequest, readJson } from '@/lib/core/http';
import { enqueueInquiries, processInquiryJob, processInquiryNotification } from '@/lib/inquiry-worker';

export const maxDuration = 60;
export const POST = withErrors('inquiry-automation/process', async req => {
  if (!isCronRequest(req)) throw fail(401, 'Unauthorized');
  const body = await readJson(req);
  if (body.mode === 'seed') return ok({ queued: await enqueueInquiries() });
  if (body.mode === 'notifications') return ok({ worked: await processInquiryNotification() });
  return ok({ worked: await processInquiryJob() });
});
