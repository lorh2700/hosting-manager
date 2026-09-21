import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import beds24 from '../netlify/functions/beds24-sync-background';
import camera from '../netlify/functions/camera-inbox-background';
import { resetDb } from './stubs/prisma';

const oldSecret = process.env.CRON_SECRET;
const oldFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = oldFetch;
  if (oldSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = oldSecret;
});

test('background workers reject unauthenticated invocations', async () => {
  process.env.CRON_SECRET = 'test';
  globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
  for (const worker of [beds24, camera]) {
    assert.equal((await worker(new Request('https://example.test'))).status, 401);
  }
});

test('Beds24 worker runs directly without calling a time-limited HTTP route', async () => {
  resetDb();
  process.env.CRON_SECRET = 'test';
  globalThis.fetch = async () => { throw new Error('Unexpected HTTP hop'); };
  const response = await beds24(new Request('https://example.test', { headers: { 'x-cron-secret': 'test' } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).propertiesSynced, 0);
});
