const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

async function main() {
  if (process.argv[2] === '--worker') {
    const deny = () => { throw new Error('Unexpected I/O during background runtime validation'); };
    require('node:net').Socket.prototype.connect = deny;
    globalThis.fetch = deny;
    const pg = require('pg');
    pg.Client.prototype.connect = deny;
    pg.Pool.prototype.connect = deny;
    const bundle = resolve(process.argv[3]);
    const job = process.argv[4];
    process.argv = [process.execPath, bundle, job, '--check'];
    await require(bundle).main();
    return;
  }

  const bundle = resolve(process.argv[2] || './background-jobs.cjs');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP)$/i.test(key)));
  Object.assign(env, {
    NODE_ENV: 'production', GCP_BACKGROUND_JOBS_ENABLED: 'true',
    JWT_SECRET: 'build-check-only-not-a-runtime-secret', CRON_SECRET: 'build-check-only-not-a-runtime-secret',
    BACKEND_DB_TRANSPORT: 'cloudsql-unix', CLOUD_SQL_CONNECTION_NAME: 'voidanchae:asia-northeast3:va-postgres',
    DB_USER: 'build-check', DB_PASSWORD: 'build-check', DB_NAME: 'build-check',
  });
  for (const job of ['beds24-sync', 'beds24-messages', 'camera-inbox', 'payments']) {
    const result = spawnSync(process.execPath, [__filename, '--worker', bundle, job], {
      env, encoding: 'utf8', timeout: 30_000, windowsHide: true,
    });
    if (result.status !== 0) throw new Error(`${job} runtime check failed: ${result.stderr || result.error?.message || result.status}`);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { job, status: 'ready' });
    console.log(JSON.stringify({ job, status: 'ready' }));
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
