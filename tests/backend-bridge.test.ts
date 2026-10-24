import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forwardBackendRequest, managementBackendPath, maybeProxyManagementRequest } from '../lib/backend-bridge';

const env = {
  NODE_ENV: 'test' as const,
  BACKEND_API_URL: 'https://backend.example.test',
  BACKEND_BRIDGE_SECRET: 'fixture-private-bridge-secret-thirty-two-characters',
  BACKEND_WEB_ORIGIN: 'https://web.example.test',
};
const target = '/api/app/v1/organizations';
const commandKey = 'fixture-command-key-0001';

function request(options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const method = options.method || 'GET';
  return new Request('https://web.example.test/api/admin/organizations?picker=1', {
    method,
    headers: { cookie: 'unrelated=secret; va_session=staff-token', ...(method === 'GET' ? {} : {
      origin: env.BACKEND_WEB_ORIGIN, 'content-type': 'application/json', 'idempotency-key': commandKey,
    }), ...options.headers },
    ...(options.body === undefined ? {} : { body: options.body }),
  });
}

function success(data: unknown = { organizations: [{ id: 'org-fixture' }] }, status = 200) {
  return Response.json({ data, meta: { requestId: 'backend-request-fixture', generatedAt: '2026-10-05T00:00:00Z' } }, {
    status, headers: { 'x-request-id': 'backend-request-fixture', 'x-access-revision': 'revision-fixture' },
  });
}

function assertPrivate(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.ok(response.headers.get('x-request-id'));
}

test('management adapter uses an explicit route and method allowlist', () => {
  assert.equal(managementBackendPath('/api/admin/organizations', 'POST'), '/api/app/v1/organizations');
  assert.equal(managementBackendPath('/api/admin/organizations/org-a/invite', 'POST'), '/api/app/v1/organizations/org-a/invitations');
  assert.equal(managementBackendPath('/api/admin/user-access/user-a', 'PATCH'), '/api/app/v1/users/user-a/access');
  assert.equal(managementBackendPath('/api/admin/organizations', 'DELETE'), null);
  assert.equal(managementBackendPath('/api/users', 'POST'), null);
});

test('invalid backend addresses and missing private configuration fail before forwarding credentials', async () => {
  const configurations: NodeJS.ProcessEnv[] = [
    { NODE_ENV: 'test' }, { ...env, BACKEND_BRIDGE_SECRET: 'short' },
    ...['http://remote.example.test', 'https://user:password@backend.example.test', 'https://backend.example.test/nested',
      'https://backend.example.test?redirect=elsewhere', 'https://backend.example.test#fragment', 'file:///private'].map(BACKEND_API_URL => ({ ...env, BACKEND_API_URL })),
  ];
  for (const config of configurations) {
    const response = await forwardBackendRequest(request(), target, { env: config, fetcher: async () => { throw new Error('must not forward'); } });
    assert.equal(response.status, 503);
    assertPrivate(response);
  }
});

test('unauthenticated, ambiguous-cookie and invalid-path requests never reach the backend', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return success(); };
  for (const cookie of ['', 'prefix_va_session=untrusted', 'va_session=a; va_session=b']) {
    const response = await forwardBackendRequest(request({ headers: { cookie } }), target, { env, fetcher });
    assert.equal(response.status, 401);
    assertPrivate(response);
    assert.equal((await response.json()).meta.requestId, response.headers.get('x-request-id'));
  }
  for (const path of ['//attacker.example/path', '/api/app/v1/../private', '/api/app/v1/users/a%2fb/access', '/api/app/v1/bootstrap?token=private']) {
    const response = await forwardBackendRequest(request(), path, { env, fetcher });
    assert.equal(response.status, 400);
    assertPrivate(response);
  }
  assert.equal(calls, 0);
});

test('forwarded requests contain only the original staff credential and server-owned bridge key', async () => {
  let calls = 0;
  const response = await forwardBackendRequest(request({ headers: { authorization: 'Bearer attacker', 'x-user-id': 'attacker', 'x-backend-key': 'attacker' } }), target, {
    env,
    fetcher: async (input, init) => {
      calls++;
      assert.equal(String(input), 'https://backend.example.test/api/app/v1/organizations?picker=1');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('cookie'), 'va_session=staff-token');
      assert.equal(headers.get('x-backend-key'), env.BACKEND_BRIDGE_SECRET);
      assert.equal(headers.get('authorization'), null);
      assert.equal(headers.get('x-user-id'), null);
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.cache, 'no-store');
      assert.ok(init?.signal);
      return success();
    },
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assertPrivate(response);
  assert.equal(response.headers.get('x-access-revision'), 'revision-fixture');
  assert.equal((await response.json()).meta.requestId, response.headers.get('x-request-id'));
});

test('legacy responses preserve established payloads and retryable conflict details', async () => {
  const response = await forwardBackendRequest(request(), target, { env, legacy: true, fetcher: async () => success() });
  assert.deepEqual(await response.json(), { organizations: [{ id: 'org-fixture' }] });
  const conflict = await forwardBackendRequest(request(), target, { env, legacy: true, fetcher: async () => Response.json({
    error: { code: 'COMMAND_CONFLICT', message: '같은 식별키로 다시 확인해 주세요.', retryable: true, details: { currentVersion: 3 } },
    meta: { requestId: 'conflict-request' },
  }, { status: 409 }) });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.headers.get('x-request-id'), 'conflict-request');
  assert.deepEqual(await conflict.json(), { error: '같은 식별키로 다시 확인해 주세요.', code: 'COMMAND_CONFLICT', retryable: true, currentVersion: 3 });
});

test('mutations require exact Origin and a caller-provided stable command key even in legacy mode', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return success(); };
  for (const headers of [
    { origin: 'https://attacker.example.test' }, { origin: '' },
  ]) {
    const response = await forwardBackendRequest(request({ method: 'POST', body: '{}', headers }), target, { env, fetcher, legacy: true });
    assert.equal(response.status, 403);
    assertPrivate(response);
  }
  for (const key of ['', 'short', 'invalid/key-here', 'x'.repeat(201)]) {
    const response = await forwardBackendRequest(request({ method: 'POST', body: '{}', headers: { 'idempotency-key': key } }), target, { env, fetcher, legacy: true });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'IDEMPOTENCY_KEY_REQUIRED');
    assertPrivate(response);
  }
  assert.equal(calls, 0);
});

test('retries preserve caller command keys and an uncertain response does not trigger a second execution', async () => {
  const keys: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    keys.push(new Headers(init?.headers).get('idempotency-key')!);
    if (keys.length === 1) throw new Error('response lost after commit');
    assert.equal(init?.body, '{"name":"test"}');
    return success({ organization: { id: 'created-once' } }, 201);
  };
  const first = await forwardBackendRequest(request({ method: 'POST', body: '{"name":"test"}' }), target, { env, fetcher, legacy: true });
  assert.equal(first.status, 503);
  assert.equal((await first.json()).retryable, true);
  assert.equal(keys.length, 1);
  const second = await forwardBackendRequest(request({ method: 'POST', body: '{"name":"test"}' }), target, { env, fetcher, legacy: true });
  assert.equal(second.status, 201);
  assert.deepEqual(keys, [commandKey, commandKey]);
});

test('announced oversized bodies and oversized UTF-8 payloads are rejected before fetch', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return success(); };
  for (const req of [
    request({ method: 'POST', body: '{}', headers: { 'content-length': '65537' } }),
    request({ method: 'POST', body: JSON.stringify({ text: '한'.repeat(22_000) }) }),
  ]) {
    const response = await forwardBackendRequest(req, target, { env, fetcher });
    assert.equal(response.status, 413);
    assertPrivate(response);
    const body = await response.json();
    assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(body.meta.requestId, response.headers.get('x-request-id'));
  }
  assert.equal(calls, 0);
});

test('streamed bodies stop reading as soon as the byte limit is exceeded', async () => {
  let pulls = 0;
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(32_768)); },
    cancel() { canceled = true; },
  }, { highWaterMark: 0 });
  const req = new Request('https://web.example.test/api/admin/organizations', {
    method: 'POST', body, duplex: 'half', headers: {
      cookie: 'va_session=token', origin: env.BACKEND_WEB_ORIGIN,
      'content-type': 'application/json', 'idempotency-key': commandKey,
    },
  } as RequestInit);
  let calls = 0;
  const response = await forwardBackendRequest(req, target, { env, fetcher: async () => { calls++; return success(); } });
  assert.equal(response.status, 413);
  assert.equal(canceled, true);
  assert.equal(pulls, 3);
  assert.equal(calls, 0);
});

test('invalid upstream error contracts are replaced with a redacted temporary failure', async () => {
  for (const payload of [null, { error: 'database-secret' }, { error: 'database-secret', meta: {} }, { error: { message: 'database-secret' }, meta: { requestId: 'test' } }]) {
    const response = await forwardBackendRequest(request(), target, { env, legacy: true, fetcher: async () => Response.json(payload, { status: 500 }) });
    assert.equal(response.status, 503);
    assertPrivate(response);
    assert.equal((await response.text()).includes('database-secret'), false);
  }
});

test('disabled management delegation leaves existing handlers in control', async () => {
  const previous = process.env.BACKEND_MANAGEMENT_ENABLED;
  try {
    delete process.env.BACKEND_MANAGEMENT_ENABLED;
    assert.equal(await maybeProxyManagementRequest(request()), null);
    process.env.BACKEND_MANAGEMENT_ENABLED = 'false';
    assert.equal(await maybeProxyManagementRequest(request()), null);
  } finally {
    if (previous === undefined) delete process.env.BACKEND_MANAGEMENT_ENABLED;
    else process.env.BACKEND_MANAGEMENT_ENABLED = previous;
  }
});
