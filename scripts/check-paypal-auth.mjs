#!/usr/bin/env node
// Run in an environment containing the PayPal credentials, e.g. Netlify build.
// Only requests an OAuth token. Never creates an order or charges a customer.
export async function checkPayPalAuth(env = process.env, request = fetch) {
  const mode = env.PAYPAL_ENV;
  if (!['live', 'sandbox'].includes(mode)) {
    return { ok: false, reason: 'Set PAYPAL_ENV to live or sandbox.' };
  }
  const missing = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'].filter(key => !env[key]?.trim());
  if (missing.length) return { ok: false, reason: `Missing: ${missing.join(', ')}` };
  const origin = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  try {
    const response = await request(`${origin}/v1/oauth2/token`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID.trim()}:${env.PAYPAL_CLIENT_SECRET.trim()}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { ok: false, mode, status: response.status, reason: 'PayPal authentication failed. Check credentials and environment.' };
    const body = await response.json();
    if (typeof body.access_token !== 'string' || !body.access_token || body.token_type?.toLowerCase() !== 'bearer') {
      return { ok: false, mode, reason: 'Unexpected authentication response.' };
    }
    return { ok: true, mode, reason: 'Authentication succeeded. No order or payment was created.' };
  } catch {
    // Never log provider bodies, tokens, credentials, or raw network errors.
    return { ok: false, mode, reason: 'Authentication request could not be completed.' };
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkPayPalAuth();
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
