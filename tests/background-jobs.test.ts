import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { legacyBackgroundJobsEnabled, gcpBackgroundJobsEnabled } from '../lib/jobs/background-controls';
import { backgroundJobName, runBackgroundJob, type BackgroundDependencies } from '../lib/jobs/background-runner';
import syncCron, { config as syncSchedule } from '../netlify/functions/beds24-sync-cron';
import syncBackground from '../netlify/functions/beds24-sync-background';
import messageCron, { config as messageSchedule } from '../netlify/functions/beds24-messages-cron';
import messageBackground from '../netlify/functions/beds24-messages-background';
import cameraCron, { config as cameraSchedule } from '../netlify/functions/camera-inbox-cron';
import cameraBackground from '../netlify/functions/camera-inbox-background';
import paymentsCron, { config as paymentsSchedule } from '../netlify/functions/payments-cron';
import { handler as paymentsBackground } from '../netlify/functions/payments-background';

const keys = ['LEGACY_BACKGROUND_JOBS_ENABLED', 'GCP_BACKGROUND_JOBS_ENABLED', 'URL', 'DEPLOY_URL', 'CRON_SECRET', 'TOSS_SECRET_KEY'] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

test('legacy jobs preserve their default and GCP jobs require explicit activation', () => {
  assert.equal(legacyBackgroundJobsEnabled({}), true);
  assert.equal(legacyBackgroundJobsEnabled({ LEGACY_BACKGROUND_JOBS_ENABLED: 'false' }), false);
  assert.equal(gcpBackgroundJobsEnabled({}), false);
  assert.equal(gcpBackgroundJobsEnabled({ GCP_BACKGROUND_JOBS_ENABLED: 'true' }), true);
  for (const value of ['FALSE', 'yes', '0']) {
    assert.throws(() => legacyBackgroundJobsEnabled({ LEGACY_BACKGROUND_JOBS_ENABLED: value }), /true or false/);
    assert.throws(() => gcpBackgroundJobsEnabled({ GCP_BACKGROUND_JOBS_ENABLED: value }), /true or false/);
  }
});

test('all eight disabled Netlify entrypoints return without any HTTP dispatch or configured credentials', async () => {
  process.env.LEGACY_BACKGROUND_JOBS_ENABLED = 'false';
  delete process.env.CRON_SECRET;
  delete process.env.URL;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected external call'); };
  for (const handler of [syncCron, messageCron, cameraCron, paymentsCron]) {
    assert.equal(await (await handler()).text(), 'Disabled');
  }
  for (const handler of [syncBackground, messageBackground, cameraBackground]) {
    assert.equal(await (await handler(new Request('https://fixture.invalid'))).text(), 'Disabled');
  }
  const response = await paymentsBackground({ headers: {} } as never, {} as never, (() => {}) as never);
  assert.ok(response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'Disabled');
  assert.equal(requests, 0);
});

test('unset legacy gate preserves the four schedules and authenticated background dispatch', async () => {
  delete process.env.LEGACY_BACKGROUND_JOBS_ENABLED;
  process.env.URL = 'https://fixture.invalid';
  process.env.CRON_SECRET = 'fixture-cron';
  process.env.TOSS_SECRET_KEY = 'fixture-payment';
  const paths: string[] = [];
  globalThis.fetch = async (url, init) => {
    paths.push(new URL(String(url)).pathname);
    assert.equal(new Headers(init?.headers).get('x-cron-secret'), 'fixture-cron');
    return new Response(null, { status: 202 });
  };
  for (const handler of [syncCron, messageCron, cameraCron, paymentsCron]) assert.equal((await handler()).status, 200);
  assert.deepEqual(paths, ['/.netlify/functions/beds24-sync-background', '/.netlify/functions/beds24-messages-background',
    '/.netlify/functions/camera-inbox-background', '/.netlify/functions/payments-background']);
  assert.deepEqual([syncSchedule.schedule, messageSchedule.schedule, cameraSchedule.schedule, paymentsSchedule.schedule],
    ['*/5 * * * *', '*/15 * * * *', '*/5 * * * *', '* * * * *']);
});

function dependencies(calls: string[], extra: Partial<BackgroundDependencies> = {}): BackgroundDependencies {
  return {
    syncReservations: async () => { calls.push('reservations'); },
    pollCameras: async () => { calls.push('camera'); },
    ingestMessages: async () => { calls.push('ingest'); return { status: 200, data: {} }; },
    processInquiries: async mode => { calls.push(mode); return { status: 200, data: { worked: false } }; },
    reconcilePayments: async () => { calls.push('payment'); return { status: 200, data: { results: [] } }; },
    paymentsConfigured: true, now: () => 0, ...extra,
  };
}

test('direct reservation and camera runners only execute their own work', async () => {
  const calls: string[] = [];
  await runBackgroundJob(backgroundJobName('beds24-sync'), dependencies(calls));
  await runBackgroundJob(backgroundJobName('camera-inbox'), dependencies(calls));
  assert.deepEqual(calls, ['reservations', 'camera']);
  assert.throws(() => backgroundJobName('all'), /Unknown/);
});

test('messages seed and drain jobs plus notifications even when ingestion returns an error', async () => {
  const calls: string[] = [];
  await assert.rejects(runBackgroundJob('beds24-messages', dependencies(calls, {
    ingestMessages: async () => { calls.push('ingest-failed'); return { status: 503, data: {} }; },
  })), /queued inquiries were still processed/);
  assert.deepEqual(calls, ['ingest-failed', 'seed', 'jobs', 'notifications']);
});

test('message drain preserves the eighty iteration and ten minute bounds', async () => {
  const calls: string[] = [];
  await runBackgroundJob('beds24-messages', dependencies(calls, {
    processInquiries: async mode => { calls.push(mode); return { status: 200, data: { worked: true } }; },
  }));
  assert.equal(calls.filter(value => value === 'jobs').length, 80);
  assert.equal(calls.filter(value => value === 'notifications').length, 80);
  calls.length = 0;
  let timeReads = 0;
  await runBackgroundJob('beds24-messages', dependencies(calls, { now: () => timeReads++ === 0 ? 0 : 600_001 }));
  assert.deepEqual(calls, ['ingest', 'seed']);
});

test('payments skip when unconfigured, stop when empty, and limit pending work to five batches', async () => {
  const calls: string[] = [];
  await runBackgroundJob('payments', dependencies(calls, { paymentsConfigured: false }));
  assert.equal(calls.length, 0);
  await runBackgroundJob('payments', dependencies(calls));
  assert.deepEqual(calls, ['payment']);
  calls.length = 0;
  await runBackgroundJob('payments', dependencies(calls, {
    reconcilePayments: async () => { calls.push('payment'); return { status: 200, data: { results: [{ status: 'retry_pending' }] } }; },
  }));
  assert.equal(calls.length, 5);
  const result = await runBackgroundJob('payments', dependencies([], { reconcilePayments: async () => ({ status: 503, data: {} }) }));
  assert.equal(result.status, 'retry_pending');
});
