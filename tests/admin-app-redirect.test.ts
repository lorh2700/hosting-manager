import test from 'node:test';
import assert from 'node:assert/strict';
import type { NextRequest } from 'next/server';
import { adminAppDestination } from '../lib/admin-app-redirect';
import { middleware } from '../middleware';

const origin = 'https://hosting-manager-platform-fe-ato3js2aoq-du.a.run.app';
const source = (path: string) => new URL(path, 'https://voidanchae.com');

test('known administrator pages retain their corresponding destination', () => {
  const routes = {
    '/admin': '/today', '/admin/': '/today', '/admin/ops': '/today',
    '/admin/calendar': '/calendar', '/admin/bookings': '/reservations',
    '/admin/cleaning-report': '/settlement', '/admin/settings/profile': '/account',
    '/admin/users': '/staff', '/admin/cleaners': '/staff', '/admin/staff': '/staff',
    '/admin/inventory': '/inventory', '/admin/laundry': '/laundry', '/admin/supplies': '/supplies',
    '/admin/guests': '/guests', '/admin/jongno-events': '/jongno-events',
    '/admin/properties': '/properties', '/admin/settings': '/settings', '/admin/activity': '/activity',
  };
  for (const [path, destination] of Object.entries(routes)) {
    for (const method of ['GET', 'HEAD']) {
      assert.equal(adminAppDestination(method, source(path), origin)?.href, origin + destination);
    }
  }
});

test('supported filters are preserved, including repeated property filters, without forwarding credentials or return URLs', () => {
  const url = source('/admin/calendar?month=2026-10&date=2026-10-31&view=week&propertyId=one&propertyId=two&channel=Booking.com&token=private&access_token=private&password=private&next=https://untrusted.invalid&redirect=https://untrusted.invalid');
  const destination = adminAppDestination('GET', url, origin)!;
  assert.equal(destination.origin, origin);
  assert.equal(destination.search, '?month=2026-10&date=2026-10-31&view=week&propertyId=one&propertyId=two&channel=Booking.com');
  assert.equal(adminAppDestination('GET', source('/admin/bookings?reservationId=event%3Asample'), origin)?.searchParams.get('reservationId'), 'event:sample');
});

test('property calendar and settings use their corresponding new pages and enforce path scope', () => {
  const calendar = adminAppDestination('GET', source('/admin/properties/Z4jFeng2zG9WpAhWtow3?month=2026-10&propertyId=wrong&propertyId=other&scope=all&properties=none'), origin)!;
  assert.equal(calendar.pathname, '/calendar');
  assert.equal(calendar.searchParams.get('month'), '2026-10');
  assert.deepEqual(calendar.searchParams.getAll('propertyId'), ['Z4jFeng2zG9WpAhWtow3']);
  assert.equal(calendar.searchParams.get('scope'), 'property');
  assert.equal(calendar.searchParams.has('properties'), false);
  for (const [suffix, section] of Object.entries({ settings: 'info', channels: 'channels', camera: 'room', 'checkout-qr': 'room' })) {
    const url = adminAppDestination('GET', source(`/admin/properties/p-unwa/${suffix}?section=wrong&section=rates`), origin)!;
    assert.equal(url.pathname, '/properties/p-unwa');
    assert.deepEqual(url.searchParams.getAll('section'), [section]);
  }
});

test('the redirect is opt-in, rejects unsafe origins, and never changes unsupported paths or write methods', () => {
  for (const unset of [undefined, '']) assert.equal(adminAppDestination('GET', source('/admin'), unset), null);
  for (const invalid of ['http://example.com', '//example.com', 'https://user:pass@example.com',
    'https://example.com/path', 'https://example.com?x=1', 'https://example.com#fragment', 'not-a-url']) {
    assert.throws(() => adminAppDestination('GET', source('/admin'), invalid), /ADMIN_APP_ORIGIN/);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(adminAppDestination(method, source('/admin'), origin), null);
  for (const path of ['/administrator', '/admin-extra', '/admin//', '/admin/messages', '/admin/issues',
    '/admin/payments', '/admin/tours', '/admin/tour-bookings', '/admin/guest-services', '/admin/guest-stays',
    '/admin/api-clients', '/admin/integrations', '/admin/properties/a%2Fb/settings', '/admin/properties/p-unwa/unknown',
    '/api/admin/calendar', '/api/auth/login', '/login', '/cleaner', '/invite/token', '/guest/welcome/token',
    '/guest-checkout', '/stay/unwa', '/i/token', '/book/unwa', '/']) {
    assert.equal(adminAppDestination('GET', source(path), origin), null, path);
    assert.equal(adminAppDestination('GET', source(path), 'invalid-origin'), null, path);
  }
});

test('middleware redirects before reading a session, while public and unsupported routes keep existing guards', async t => {
  const previous = process.env.ADMIN_APP_ORIGIN;
  process.env.ADMIN_APP_ORIGIN = origin;
  t.after(() => { if (previous === undefined) delete process.env.ADMIN_APP_ORIGIN; else process.env.ADMIN_APP_ORIGIN = previous; });
  const request = (path: string, method = 'GET', protectedSession = false) => {
    const url = source(path);
    return { method, url: url.href, nextUrl: url, headers: new Headers({ 'x-forwarded-host': 'untrusted.invalid' }),
      cookies: { get() { if (protectedSession) throw Error('Session must not be read'); return undefined; } },
    } as unknown as NextRequest;
  };
  for (const method of ['GET', 'HEAD']) {
    const response = await middleware(request('/admin/calendar?month=2026-10', method, true));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), `${origin}/calendar?month=2026-10`);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.has('set-cookie'), false);
  }
  assert.match((await middleware(request('/admin/messages'))).headers.get('location')!, /^https:\/\/voidanchae.com\/login\?/);
  assert.equal((await middleware(request('/api/admin/calendar'))).status, 401);
  for (const path of ['/guest/welcome/token', '/guest-checkout', '/stay/unwa', '/i/token', '/invite/token', '/api/auth/login']) {
    assert.equal((await middleware(request(path, 'GET', true))).status, 200, path);
  }
});
