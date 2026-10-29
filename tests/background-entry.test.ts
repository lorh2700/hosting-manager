import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let directory: string;
let bundle: string;
before(async () => {
  const temporaryRoot = join(root, 'tmp');
  mkdirSync(temporaryRoot, { recursive: true });
  directory = mkdtempSync(join(temporaryRoot, 'background-entry-'));
  bundle = join(directory, 'background-jobs.cjs');
  await build({ entryPoints: [join(root, 'scripts/run-background-job.ts')], outfile: bundle,
    bundle: true, platform: 'node', target: 'node24', format: 'cjs', packages: 'external', tsconfig: join(root, 'tsconfig.json'), sourcemap: false });
});
after(() => { if (bundle) rmSync(bundle, { force: true }); if (directory) rmdirSync(directory); });

function fixtureEnvironment(enabled = true): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA)$/i.test(key))) };
  Object.assign(env, { NODE_ENV: 'production', GCP_BACKGROUND_JOBS_ENABLED: String(enabled),
    JWT_SECRET: 'fixture-runtime-only', CRON_SECRET: 'fixture-cron-only',
    BACKEND_DB_TRANSPORT: enabled ? 'cloudsql-unix' : 'invalid-disabled-config',
    CLOUD_SQL_CONNECTION_NAME: 'voidanchae:asia-northeast3:va-postgres',
    DB_USER: 'fixture', DB_PASSWORD: 'fixture', DB_NAME: 'fixture' });
  return env;
}

function run(name: string, option?: string, enabled = true) {
  const result = spawnSync(process.execPath, ['--require', join(root, 'tests/fixtures/background-job-no-io.cjs'),
    bundle, name, ...(option ? [option] : [])], { cwd: root, env: fixtureEnvironment(enabled), windowsHide: true, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout.trim());
}

test('the built CJS entrypoint skips disabled jobs before any database configuration or I/O', () => {
  for (const name of ['beds24-sync', 'beds24-messages', 'camera-inbox', 'payments']) {
    assert.deepEqual(run(name, undefined, false), { job: name, status: 'disabled' });
  }
});

test('check and dry-run import every worker without connecting, locking, fetching or running work', () => {
  for (const name of ['beds24-sync', 'beds24-messages', 'camera-inbox', 'payments']) {
    for (const option of ['--check', '--dry-run']) assert.deepEqual(run(name, option), { job: name, status: 'ready' });
  }
});

test('the built worker exits immediately on lost lock and never continues operational work', () => {
  const script = `
    const { EventEmitter } = require('node:events');
    const { withBackgroundJobLock } = require(process.argv[1]);
    const client = new EventEmitter();
    client.connect = async () => {};
    client.query = async () => ({ rows: [{ acquired: true }] });
    client.end = async () => {};
    withBackgroundJobLock('beds24-sync', async () => {
      client.emit('error', new Error('fixture-private-details'));
      process.stdout.write('unsafe-continuation');
    }, () => client);
  `;
  const result = spawnSync(process.execPath, ['--require', join(root, 'tests/fixtures/background-job-no-io.cjs'), '-e', script, bundle],
    { cwd: root, env: fixtureEnvironment(), windowsHide: true, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr.trim()), { component: 'legacy-background-job', event: 'lock-lost', job: 'beds24-sync' });
});
