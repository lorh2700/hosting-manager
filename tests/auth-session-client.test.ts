import test from 'node:test';
import assert from 'node:assert/strict';
import { readClientSession } from '../lib/auth-session-client';

const responding = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;

test('a confirmed unauthorized session is the only response classified as signed out', async () => {
  assert.deepEqual(await readClientSession(responding(401, { error: '로그인이 필요합니다.' })), { kind: 'signed-out' });
  for (const status of [403, 429, 500, 502, 503, 504]) {
    const result = await readClientSession(responding(status, { error: 'server unavailable' }));
    assert.equal(result.kind, 'unavailable');
  }
});

test('a migration failure remains retryable and explains the missing database update', async () => {
  const result = await readClientSession(responding(503, { migrationRequired: true }));
  assert.equal(result.kind, 'unavailable');
  if (result.kind === 'unavailable') assert.match(result.error, /데이터베이스 업데이트/);
});

test('network errors and malformed successful responses do not log out the user', async () => {
  const offline = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
  assert.equal((await readClientSession(offline)).kind, 'unavailable');
  assert.equal((await readClientSession(responding(200, { user: null, profile: null }))).kind, 'unavailable');
  const invalidJson = (async () => new Response('<html>upstream error</html>', { status: 502 })) as typeof fetch;
  assert.equal((await readClientSession(invalidJson)).kind, 'unavailable');
});

test('retry restores the authenticated identity and current permissions from the server', async () => {
  const session = { user: { id: 'user-1', email: 'user@example.invalid', password: 'never expose' }, profile: { role: 'admin', status: 'active', displayName: '사용자', propertyIds: ['property-1'], organizationId: 'organization-1', enabledModules: ['calendar'] } };
  let attempt = 0;
  const transient = (async (_url: string, options: RequestInit) => {
    assert.equal(options.cache, 'no-store'); assert(options.signal);
    attempt += 1;
    return new Response(JSON.stringify(attempt === 1 ? { error: 'temporary failure' } : session), { status: attempt === 1 ? 500 : 200 });
  }) as typeof fetch;
  assert.equal((await readClientSession(transient)).kind, 'unavailable');
  const recovered = await readClientSession(transient);
  assert.equal(recovered.kind, 'authenticated');
  if (recovered.kind === 'authenticated') {
    assert.deepEqual(recovered.user, { id: 'user-1', email: 'user@example.invalid' });
    assert.deepEqual(recovered.profile.enabledModules, ['calendar']);
    assert.deepEqual(recovered.profile.propertyIds, ['property-1']);
  }
});
