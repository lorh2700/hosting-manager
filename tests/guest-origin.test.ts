import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireStayOrigin, requireStayCsrf, guestStayCsrf } from '../lib/guest-stay-store';
import { POST as guestLogin } from '../app/api/public/guest-stay/login/route';

function withCanonical(value: string | undefined, run: () => void) {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  if (value === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = value;
  try { run(); } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous;
  }
}
function proxyRequest(origin = 'https://voidanchae.com', extra: Record<string, string> = {}) {
  return new Request('http://0.0.0.0:8080/api/public/guest-stay/login', {
    method: 'POST', headers: { origin, host: 'voidanchae.com', 'x-forwarded-host': 'voidanchae.com',
      'x-forwarded-proto': 'https', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...extra }, body: '{}',
  });
}

test('guest writes accept the configured canonical HTTPS origin behind Cloud Run without trusting proxy headers', () => {
  withCanonical('https://voidanchae.com/', () => {
    assert.doesNotThrow(() => requireStayOrigin(proxyRequest()));
    assert.throws(() => requireStayOrigin(proxyRequest('https://evil.test', {
      host: 'evil.test', 'x-forwarded-host': 'evil.test',
    })), /다시 시도/);
    for (const origin of ['https://voidanchae.com.evil.test', 'https://www.voidanchae.com', 'http://voidanchae.com', 'null']) {
      assert.throws(() => requireStayOrigin(proxyRequest(origin)), /다시 시도/);
    }
    assert.throws(() => requireStayOrigin(proxyRequest(undefined, { 'sec-fetch-site': 'cross-site' })), /다시 시도/);
  });
});

test('unset or malformed canonical settings cannot authorize forwarded origins', () => {
  for (const setting of [undefined, '', 'not a URL', 'http://voidanchae.com', 'https://user:password@voidanchae.com',
    'https://voidanchae.com/path', 'https://voidanchae.com?x=1', 'https://voidanchae.com#fragment']) {
    withCanonical(setting, () => assert.throws(() => requireStayOrigin(proxyRequest()), /다시 시도/));
  }
});

test('same-origin local and direct requests continue to work; missing Origin remains forbidden', () => {
  for (const setting of [undefined, 'https://voidanchae.com']) {
    withCanonical(setting, () => {
      for (const origin of ['http://localhost:3117', 'http://127.0.0.1:3117', 'https://voidanchae.com']) {
        assert.doesNotThrow(() => requireStayOrigin(new Request(`${origin}/api`, { headers: { origin } })));
      }
      assert.throws(() => requireStayOrigin(new Request('https://voidanchae.com/api')), /다시 시도/);
    });
  }
});

test('proxy origin authorization still requires the current guest session CSRF proof', () => {
  withCanonical('https://voidanchae.com', () => {
    const token = 'fixture-session-one';
    assert.doesNotThrow(() => requireStayCsrf(proxyRequest(), token, { csrfToken: guestStayCsrf(token) }));
    assert.throws(() => requireStayCsrf(proxyRequest(), token, { csrfToken: guestStayCsrf('fixture-session-two') }), /새로고침/);
    assert.throws(() => requireStayCsrf(proxyRequest('https://evil.test'), token, { csrfToken: guestStayCsrf(token) }), /다시 시도/);
  });
});

test('guest login reaches input validation behind the proxy instead of failing origin validation', async () => {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = 'https://voidanchae.com';
  try {
    const response = await guestLogin(proxyRequest(), { params: Promise.resolve({}) });
    assert.equal(response.status, 400);
    assert.equal((response as unknown as { body: { code: string } }).body.code, 'invalid_credentials');
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous;
  }
});
