import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { NextRequest } from 'next/server';
import { middleware } from '../middleware';

async function loginLocation(requestUrl: string, forwardedHost: string) {
  const nextUrl = new URL(requestUrl);
  const request = { url: requestUrl, nextUrl, headers: new Headers({ 'x-forwarded-host': forwardedHost, 'x-forwarded-proto': 'https' }),
    cookies: { get: () => undefined } } as unknown as NextRequest;
  const response = await middleware(request);
  assert.equal(response.status, 307);
  return response.headers.get('location');
}

function configure(t: TestContext, values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

test('production proxy login redirect uses the configured HTTPS origin and preserves return path', async t => {
  configure(t, { NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://voidanchae.com', LEGACY_HTTP_MAINTENANCE: 'false' });
  const location = await loginLocation('http://0.0.0.0:8080/admin/calendar?month=2026-10&propertyId=sample', 'attacker.example');
  const url = new URL(location!);
  assert.equal(url.origin, 'https://voidanchae.com');
  assert.equal(url.pathname, '/login');
  assert.equal(url.searchParams.get('next'), '/admin/calendar?month=2026-10&propertyId=sample');
});

test('local development login remains on its current address', async t => {
  configure(t, { NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'https://voidanchae.com', LEGACY_HTTP_MAINTENANCE: 'false' });
  const url = new URL((await loginLocation('http://127.0.0.1:3177/admin', 'attacker.example'))!);
  assert.equal(url.origin, 'http://127.0.0.1:3177');
});

test('unconfigured or unsafe origins cannot set the redirect host', async t => {
  configure(t, { NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: undefined, LEGACY_HTTP_MAINTENANCE: 'false' });
  for (const candidate of [undefined, '', 'http://voidanchae.com', 'https://user:password@voidanchae.com',
    'https://voidanchae.com/path', 'https://voidanchae.com?x=y', 'https://voidanchae.com#fragment', '//attacker.example']) {
    if (candidate === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = candidate;
    const url = new URL((await loginLocation('https://current.example/admin', 'attacker.example'))!);
    assert.equal(url.origin, 'https://current.example');
  }
});
