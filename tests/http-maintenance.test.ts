import test from 'node:test';
import assert from 'node:assert/strict';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server.js';
import type { NextRequest } from 'next/server';
import { legacyHttpMaintenanceResponse } from '../lib/http-maintenance';
import { config, middleware } from '../middleware';

const enabled = { LEGACY_HTTP_MAINTENANCE: 'true' };
const transactions = ['/guest/welcome/v3_token', '/i/i2_token', '/guest-checkout', '/stay/unwa',
  '/guest/unwa', '/invite/account-token', '/book/checkout/order-id'];

test('maintenance is opt-in and leaves static, login, and read-only calendars available', () => {
  for (const env of [{}, { LEGACY_HTTP_MAINTENANCE: '' }, { LEGACY_HTTP_MAINTENANCE: 'false' }]) {
    assert.equal(legacyHttpMaintenanceResponse('/api/auth/login', env), null);
    assert.equal(legacyHttpMaintenanceResponse('/guest/welcome/v3_token', env), null);
  }
  for (const path of ['/', '/login', '/_next/static/app.js', '/images/photo.webp', '/favicon.ico',
    '/book/unwa', '/c/calendar-token', '/ical/unwa', '/api-docs', '/guesthouse', '/staycation', '/invited']) {
    assert.equal(legacyHttpMaintenanceResponse(path, enabled), null, path);
  }
});

test('API maintenance produces a retryable, non-cacheable 503 including public and worker routes', async () => {
  for (const path of ['/api', '/api/', '/api/auth/login', '/api/public/guest-checkout',
    '/api/public/welcomepad/data', '/api/sync', '/api/cron/payments', '/api/inquiry-automation/process',
    '/api/internal/cleaning-assignment-notifications', '/api/export/token.ics']) {
    const response = legacyHttpMaintenanceResponse(path, enabled)!;
    assert.equal(response.status, 503, path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Retry-After'), '60');
    assert.equal((await response.json()).retryable, true);
  }
});

test('GET invitation recovery and automatic checkout pages are covered by the real Next matcher', () => {
  for (const url of [...transactions, '/api', '/api/public/guest-checkout', '/api/export/token.ics']) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), true, url);
    assert.equal(legacyHttpMaintenanceResponse(url, enabled)?.status, 503, url);
  }
  for (const url of ['/login', '/_next/static/app.js', '/images/photo.webp', '/c/token', '/ical/unwa']) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), false, url);
  }
});

test('middleware gates every method before session access and existing cron/public exemptions', async t => {
  const previous = process.env.LEGACY_HTTP_MAINTENANCE;
  process.env.LEGACY_HTTP_MAINTENANCE = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.LEGACY_HTTP_MAINTENANCE;
    else process.env.LEGACY_HTTP_MAINTENANCE = previous;
  });
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    for (const path of ['/api/auth/login', '/api/inquiry-automation/process', '/api/private', ...transactions]) {
      const url = new URL(path, 'https://voidanchae.com');
      const request = { url: url.href, nextUrl: url, method,
        get cookies() { throw new Error('Session must not be read during maintenance'); },
      } as unknown as NextRequest;
      const response = await middleware(request);
      assert.equal(response.status, 503, `${method} ${path}`);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
  }
});

test('disabling maintenance restores anonymous guest pages without weakening protected API authentication', async t => {
  const previous = process.env.LEGACY_HTTP_MAINTENANCE;
  delete process.env.LEGACY_HTTP_MAINTENANCE;
  t.after(() => {
    if (previous !== undefined) process.env.LEGACY_HTTP_MAINTENANCE = previous;
  });
  for (const path of transactions) {
    const url = new URL(path, 'https://voidanchae.com');
    const request = { url: url.href, nextUrl: url,
      get cookies() { throw new Error('Public guest pages must not require a session'); },
    } as unknown as NextRequest;
    assert.equal((await middleware(request)).status, 200, path);
  }
  const url = new URL('/api/users', 'https://voidanchae.com');
  const request = { url: url.href, nextUrl: url, cookies: { get: () => undefined } } as unknown as NextRequest;
  assert.equal((await middleware(request)).status, 401);
});
