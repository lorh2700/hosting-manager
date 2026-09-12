import type { Handler } from '@netlify/functions';

const handler: Handler = async event => {
  const secret = process.env.CRON_SECRET;
  if (!secret || event.headers['x-cron-secret'] !== secret) return { statusCode: 401, body: 'Unauthorized' };
  if ((!process.env.TOSS_SECRET_KEY && !process.env.PAYPAL_CLIENT_SECRET) || !process.env.URL) return { statusCode: 200, body: 'Not configured' };
  // Small durable batches fit each Next route invocation. Background execution avoids the
  // scheduler's shorter timeout; failures leave orders for the next run.
  for (let batch = 0; batch < 5; batch++) {
    const res = await fetch(`${process.env.URL}/api/cron/payments`, { method: 'POST',
      headers: { 'x-cron-secret': secret }, signal: AbortSignal.timeout(65_000) });
    if (!res.ok) { console.error('[payments] reconciliation retry pending', res.status); break; }
    const data = await res.json();
    if (!data.results?.length) break;
  }
  return { statusCode: 200, body: 'Completed' };
};
export { handler };
