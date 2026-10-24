import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOperationsJsonClient } from '../lib/operations-command-client';

function fixture() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const sent: string[] = [];
  let sequence = 0;
  const create = (responses: Array<Response | Error>) => createOperationsJsonClient({ storage: () => storage, randomId: () => `test-request-${String(++sequence).padStart(8, '0')}`,
    fetcher: (async (_url, init) => {
      sent.push(new Headers(init?.headers).get('idempotency-key') || '');
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response);
      return response;
    }) as typeof fetch,
  });
  return { values, sent, create };
}
const request = { method: 'POST', body: JSON.stringify({ name: '새 사업자', email: 'private@example.test' }) };

test('client reuses command key after lost response and reload, then releases it only after success', async () => {
  const { values, sent, create } = fixture();
  await assert.rejects(create([new Error('lost response')])('/api/admin/organizations', request));
  assert.equal(values.size, 1);
  assert.ok(!JSON.stringify([...values]).includes('private@example.test'));
  await create([Response.json({ organization: { id: 'one' } })])('/api/admin/organizations', request);
  assert.equal(sent[0], sent[1]);
  assert.equal(values.size, 0);
  await create([Response.json({ organization: { id: 'two' } })])('/api/admin/organizations', request);
  assert.notEqual(sent[1], sent[2]);
});

test('server unavailable and retryable conflict retain same key; edited input gets its own key', async () => {
  const { sent, create } = fixture();
  const client = create([Response.json({ error: 'unavailable' }, { status: 503 }), Response.json({ retryable: true }, { status: 409 }), Response.json({}), Response.json({})]);
  await client('/api/admin/organizations', request);
  await client('/api/admin/organizations', request);
  await client('/api/admin/organizations', { ...request, body: JSON.stringify({ name: '다른 사업자' }) });
  await client('/api/admin/organizations', request);
  assert.equal(sent[0], sent[1]);
  assert.notEqual(sent[1], sent[2]);
  assert.equal(sent[0], sent[3]);
});

test('access-changed replay conflict retains key but validation rejection releases it', async () => {
  const { values, sent, create } = fixture();
  const client = create([Response.json({ code: 'ACCESS_CHANGED' }, { status: 409 }), Response.json({ error: 'invalid' }, { status: 400 }), Response.json({})]);
  await client('/api/admin/organizations', request);
  assert.equal(values.size, 1);
  await client('/api/admin/organizations', request);
  assert.equal(values.size, 0);
  await client('/api/admin/organizations', request);
  assert.equal(sent[0], sent[1]);
  assert.notEqual(sent[1], sent[2]);
});

test('read requests do not allocate command keys; explicit caller key is preserved', async () => {
  const { values, sent, create } = fixture();
  const client = create([Response.json({}), Response.json({})]);
  await client('/api/admin/organizations');
  await client('/api/admin/organizations', { ...request, headers: { 'Idempotency-Key': 'caller-provided-key' } });
  assert.deepEqual(sent, ['', 'caller-provided-key']);
  assert.equal(values.size, 0);
});

test('an unreadable success response keeps the original key for reconciliation', async () => {
  const { sent, create } = fixture();
  const client = create([new Response('<html>proxy error</html>'), Response.json({ organization: { id: 'one' } })]);
  await assert.rejects(client('/api/admin/organizations', request), /처리 결과/);
  await client('/api/admin/organizations', request);
  assert.equal(sent[0], sent[1]);
});
