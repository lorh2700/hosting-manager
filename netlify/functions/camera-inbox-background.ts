/**
 * camera-inbox-cron 의 백그라운드 짝. /api/cron/camera-inbox 를 비밀키로 호출한다.
 */
const handler = async () => {
  const baseUrl = process.env.URL || process.env.DEPLOY_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!baseUrl) return new Response('Missing URL', { status: 500 });
  if (!cronSecret) {
    console.error('[camera-inbox-background] CRON_SECRET is not configured');
    return new Response('CRON_SECRET not configured', { status: 500 });
  }
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/cron/camera-inbox`, {
      method: 'POST',
      headers: { 'x-cron-secret': cronSecret, 'content-type': 'application/json' },
      body: '{}',
    });
    const body = await res.text();
    const durationMs = Date.now() - started;
    if (!res.ok) {
      console.error(`[camera-inbox-background] failed ${res.status} in ${durationMs}ms:`, body);
      return new Response(body, { status: res.status });
    }
    console.log(`[camera-inbox-background] ok in ${durationMs}ms:`, body);
    return new Response(body, { status: 200 });
  } catch (err) {
    console.error('[camera-inbox-background] fetch error:', err);
    return new Response(String(err), { status: 500 });
  }
};

export default handler;
