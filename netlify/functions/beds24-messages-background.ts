/**
 * Background sibling for the messages cron — same rationale as
 * beds24-sync-background.ts: 15-minute timeout for the heavier work.
 */
const handler = async (req: Request) => {
  const baseUrl = process.env.URL || process.env.DEPLOY_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!baseUrl) {
    console.error('[beds24-messages-background] Missing URL env');
    return new Response('Missing URL', { status: 500 });
  }
  if (!cronSecret) {
    console.error('[beds24-messages-background] CRON_SECRET is not configured');
    return new Response('CRON_SECRET not configured', { status: 500 });
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) return new Response('Unauthorized', { status: 401 });

  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/beds24/messages`, {
      method: 'POST',
      headers: {
        'x-cron-secret': cronSecret,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const body = await res.text();
    const durationMs = Date.now() - started;
    if (!res.ok) {
      console.error(`[beds24-messages-background] failed ${res.status} in ${durationMs}ms:`, body);
      // Existing queued replies and staff alerts still need recovery when ingestion fails.
    }
    if (res.ok) console.log(`[beds24-messages-background] ok in ${durationMs}ms:`, body);
    // Drain durable work one bounded API call at a time. A later cron recovers unfinished work.
    const work = async (mode: string) => {
      const result = await fetch(`${baseUrl}/api/inquiry-automation/process`, {
        method: 'POST', headers: { 'x-cron-secret': cronSecret, 'content-type': 'application/json' },
        body: JSON.stringify({ mode }), signal: AbortSignal.timeout(65_000),
      });
      if (!result.ok) throw new Error(`Inquiry worker HTTP ${result.status}`);
      return result.json();
    };
    await work('seed');
    for (let i = 0; i < 80 && Date.now() - started < 10 * 60_000; i++) {
      const job = await work('jobs');
      const notification = await work('notifications');
      if (!job.worked && !notification.worked) break;
    }
    return new Response(body, { status: res.status });
  } catch (err) {
    console.error('[beds24-messages-background] fetch error:', err);
    return new Response(String(err), { status: 500 });
  }
};

export default handler;
