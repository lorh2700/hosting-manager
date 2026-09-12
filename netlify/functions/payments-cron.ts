import type { Config } from '@netlify/functions';
const handler = async () => {
  // Disabling new sales must not strand previously created orders.
  if (!process.env.TOSS_SECRET_KEY && !process.env.PAYPAL_CLIENT_SECRET) return new Response('Not configured');
  const origin = process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!origin || !secret) return new Response('Missing configuration', { status: 500 });
  const response = await fetch(`${origin}/.netlify/functions/payments-background`, { method: 'POST', headers: { 'x-cron-secret': secret }, signal: AbortSignal.timeout(20_000) });
  return new Response(response.ok ? 'Triggered' : 'Retry pending', { status: response.ok ? 200 : 500 });
};
export default handler;
export const config: Config = { schedule: '* * * * *' };
