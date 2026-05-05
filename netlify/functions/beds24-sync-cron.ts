import type { Config } from '@netlify/functions';

/**
 * Scheduled function — Netlify gives scheduled functions the regular
 * 26-second sync timeout (10s on Free), which isn't enough for the
 * full Beds24 sync to complete. So this cron just *kicks off* the
 * background variant (15-minute timeout) and returns immediately.
 */
const handler = async () => {
  const baseUrl = process.env.URL || process.env.DEPLOY_URL;
  if (!baseUrl) {
    console.error('[beds24-sync-cron] Missing URL env');
    return new Response('Missing URL', { status: 500 });
  }

  try {
    // POST to a background function returns 202 immediately, even though
    // the actual sync work continues running for up to 15 minutes.
    const res = await fetch(`${baseUrl}/.netlify/functions/beds24-sync-background`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    console.log(`[beds24-sync-cron] background trigger -> ${res.status}`);
    return new Response('Triggered', { status: 200 });
  } catch (err) {
    console.error('[beds24-sync-cron] trigger failed:', err);
    return new Response(String(err), { status: 500 });
  }
};

export default handler;

export const config: Config = {
  schedule: '*/5 * * * *',
};
