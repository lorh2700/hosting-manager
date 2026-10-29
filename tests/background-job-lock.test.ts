import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { withBackgroundJobLock } from '../scripts/run-background-job';

class LockClient extends EventEmitter {
  queries: string[] = [];
  owned: string | null = null;
  ended = false;
  connectError: Error | null = null;
  releaseError: Error | null = null;
  malformed = false;
  readonly locks: Set<string>;
  constructor(locks = new Set<string>()) { super(); this.locks = locks; }
  async connect() { if (this.connectError) throw this.connectError; }
  async query(sql: string, values: number[]) {
    this.queries.push(sql);
    const key = values.join(':');
    if (sql.includes('pg_try_advisory_lock')) {
      if (this.malformed) return { rows: [] };
      if (this.locks.has(key)) return { rows: [{ acquired: false }] };
      this.locks.add(key);
      this.owned = key;
      return { rows: [{ acquired: true }] };
    }
    assert.ok(sql.includes('pg_advisory_unlock'));
    if (this.releaseError) throw this.releaseError;
    assert.equal(key, this.owned);
    return { rows: [{ released: this.locks.delete(key) }] };
  }
  async end() {
    this.ended = true;
    if (this.owned) this.locks.delete(this.owned);
    this.emit('end');
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('live GCP jobs cannot fall back to a transaction-pooled TCP database', async () => {
  const previous = process.env.BACKEND_DB_TRANSPORT;
  let worked = false;
  try {
    delete process.env.BACKEND_DB_TRANSPORT;
    await assert.rejects(withBackgroundJobLock('beds24-sync', async () => { worked = true; }), /Cloud SQL socket/);
    process.env.BACKEND_DB_TRANSPORT = 'tcp';
    await assert.rejects(withBackgroundJobLock('beds24-sync', async () => { worked = true; }), /Cloud SQL socket/);
    assert.equal(worked, false);
  } finally {
    if (previous === undefined) delete process.env.BACKEND_DB_TRANSPORT;
    else process.env.BACKEND_DB_TRANSPORT = previous;
  }
});

test('overlapping executions of the same job skip; the next execution can run after release', async () => {
  const locks = new Set<string>();
  const first = new LockClient(locks), second = new LockClient(locks), third = new LockClient(locks);
  const entered = deferred(), finish = deferred();
  const running = withBackgroundJobLock('beds24-sync', async () => { entered.resolve(); await finish.promise; return 'first'; }, () => first);
  await entered.promise;
  let duplicateWork = false;
  assert.deepEqual(await withBackgroundJobLock('beds24-sync', async () => { duplicateWork = true; }, () => second),
    { job: 'beds24-sync', status: 'skipped', reason: 'already_running' });
  assert.equal(duplicateWork, false);
  assert.equal(second.queries.length, 1);
  assert.equal(second.ended, true);
  assert.equal(locks.size, 1);
  finish.resolve();
  assert.equal(await running, 'first');
  assert.equal(await withBackgroundJobLock('beds24-sync', async () => 'next', () => third), 'next');
  assert.equal(locks.size, 0);
});

test('different job types hold independent locks and can run concurrently', async () => {
  const locks = new Set<string>();
  const finish = deferred();
  const entered = ['beds24-sync', 'beds24-messages', 'camera-inbox', 'payments'].map(() => deferred());
  const clients: LockClient[] = [];
  const running = (['beds24-sync', 'beds24-messages', 'camera-inbox', 'payments'] as const).map((name, i) => {
    const client = new LockClient(locks); clients.push(client);
    return withBackgroundJobLock(name, async () => { entered[i].resolve(); await finish.promise; }, () => client);
  });
  await Promise.all(entered.map(item => item.promise));
  assert.equal(locks.size, 4);
  finish.resolve();
  await Promise.all(running);
  assert.equal(locks.size, 0);
  assert.ok(clients.every(client => client.ended && client.queries.length === 2));
});

test('work failure releases the session lock and closes its dedicated connection', async () => {
  const client = new LockClient();
  const error = new Error('fixture-work-failure');
  await assert.rejects(withBackgroundJobLock('camera-inbox', async () => { throw error; }, () => client), error);
  assert.equal(client.ended, true);
  assert.equal(client.locks.size, 0);
  assert.equal(client.queries.length, 2);
  assert.equal(client.listenerCount('error'), 0);
  assert.equal(client.listenerCount('end'), 0);
});

test('connection and malformed acquire failures never execute work and still close the client', async () => {
  for (const failure of ['connect', 'malformed']) {
    const client = new LockClient();
    if (failure === 'connect') client.connectError = new Error('fixture-connect-failure');
    else client.malformed = true;
    let worked = false;
    await assert.rejects(withBackgroundJobLock('payments', async () => { worked = true; }, () => client));
    assert.equal(worked, false);
    assert.equal(client.ended, true);
  }
});

test('unlock failure closes the dedicated connection so its session lock cannot leak', async () => {
  const client = new LockClient();
  client.releaseError = new Error('fixture-release-failure');
  await assert.rejects(withBackgroundJobLock('beds24-messages', async () => 'done', () => client), /fixture-release-failure/);
  assert.equal(client.ended, true);
  assert.equal(client.locks.size, 0);
});

test('losing an active lock connection triggers the fail-stop handler once; normal cleanup does not', async () => {
  const client = new LockClient();
  let losses = 0;
  await withBackgroundJobLock('beds24-sync', async () => {
    client.emit('error', new Error('fixture-disconnect'));
    client.emit('end');
  }, () => client, () => { losses++; });
  assert.equal(losses, 1);
  const normal = new LockClient();
  await withBackgroundJobLock('beds24-sync', async () => undefined, () => normal, () => { losses++; });
  assert.equal(losses, 1);
});
