import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { withAuth, withErrors, ok } from '../lib/core/http';
import { actAsAdmin } from './stubs/auth';
import { resetDb } from './stubs/prisma';

beforeEach(() => { resetDb(); actAsAdmin(); });

test('Next static route context without params executes protected handlers', async () => {
  let reads = 0;
  const route = withAuth('properties', async (_request, { params }) => {
    reads++;
    assert.deepEqual(params, {});
    return ok([{ id: 'p1' }]);
  });
  for (const context of [{}, { params: undefined }, { params: Promise.resolve(undefined) }]) {
    const response = await route(new Request('http://localhost/api/properties'), context as any);
    assert.equal(response.status, 200);
  }
  assert.equal(reads, 3);
});

test('dynamic route context still passes the resolved identifier to the handler', async () => {
  const route = withAuth<{ id: string }>('properties/id', async (_request, { params }) => ok({ id: params.id }));
  const response = await route(new Request('http://localhost/api/properties/p1'), { params: Promise.resolve({ id: 'p1' }) });
  assert.equal(response.status, 200);
  assert.deepEqual((response as any).body, { id: 'p1' });
});

test('public static routes receive an empty params object under Next context', async () => {
  const route = withErrors('public/properties', async (_request, { params }) => ok(Object.keys(params)));
  const response = await route(new Request('http://localhost/api/public/properties'), {} as any);
  assert.equal(response.status, 200);
  assert.deepEqual((response as any).body, []);
});
