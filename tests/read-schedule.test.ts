import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readSchedule } from '../lib/read-schedule';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('schedule read recovers from one transient server failure', async () => {
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? new Response('', { status: 500 }) : Response.json([{ id: 'cleaning' }]);
  assert.deepEqual(await readSchedule('/api/cleanings'), [{ id: 'cleaning' }]);
  assert.equal(calls, 2);
});

test('expired login is explained without retrying', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 401 }); };
  await assert.rejects(readSchedule('/api/properties'), /다시 로그인/);
  assert.equal(calls, 1);
});

test('persistent network failure stops after two reads', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
  await assert.rejects(readSchedule('/api/cleanings'), /서버 연결이 지연/);
  assert.equal(calls, 2);
});
