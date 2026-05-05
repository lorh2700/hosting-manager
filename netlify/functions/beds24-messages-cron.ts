import type { Config } from '@netlify/functions';

/**
 * Scheduled function — kicks off the background sibling and returns
 * immediately so we don't get killed by the 26-second sync timeout.
 */
const handler = async () => {
  const baseUrl = process.env.URL || process.env.DEPLOY_URL;
  if (!baseUrl) {
    console.error('[beds24-messages-cron] Missing URL env');
    return new Response('Missing URL', { status: 500 });
  }

  try {
    const res = await fetch(`${baseUrl}/.netlify/functions/beds24-messages-background`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    console.log(`[beds24-messages-cron] background trigger -> ${res.status}`);
    return new Response('Triggered', { status: 200 });
  } catch (err) {
    console.error('[beds24-messages-cron] trigger failed:', err);
    return new Response(String(err), { status: 500 });
  }
};

export default handler;

export const config: Config = {
  schedule: '*/15 * * * *',
};
