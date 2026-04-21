import type { Config } from '@netlify/functions';

const handler = async () => {
  const baseUrl = process.env.URL || process.env.DEPLOY_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!baseUrl) {
    console.error('[beds24-sync-cron] Missing URL env; cannot determine site origin');
    return new Response('Missing URL', { status: 500 });
  }
  if (!cronSecret) {
    console.error('[beds24-sync-cron] CRON_SECRET is not configured');
    return new Response('CRON_SECRET not configured', { status: 500 });
  }

  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/beds24/sync-all`, {
      method: 'POST',
      headers: {
        'x-cron-secret': cronSecret,
        'content-type': 'application/json',
      },
    });
    const body = await res.text();
    const durationMs = Date.now() - started;
    if (!res.ok) {
      console.error(`[beds24-sync-cron] sync-all failed ${res.status} in ${durationMs}ms:`, body);
      return new Response(body, { status: res.status });
    }
    console.log(`[beds24-sync-cron] sync-all ok in ${durationMs}ms:`, body);
    return new Response(body, { status: 200 });
  } catch (err) {
    console.error('[beds24-sync-cron] fetch error:', err);
    return new Response(String(err), { status: 500 });
  }
};

export default handler;

export const config: Config = {
  schedule: '*/5 * * * *',
};
