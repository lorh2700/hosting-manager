import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { postgresPoolOptions } from '../lib/postgres-config';
import { backendPoolOptions } from '../packages/data/backend-client';

const cloudSql = {
  NODE_ENV: 'production', BACKEND_DB_TRANSPORT: 'cloudsql-unix',
  CLOUD_SQL_CONNECTION_NAME: 'voidanchae:asia-northeast3:va-postgres',
  DB_USER: 'application', DB_PASSWORD: 'private-fixture-password', DB_NAME: 'hosting_manager',
};

test('explicit Cloud SQL transport resolves the mounted Unix socket in pg without a network connection', () => {
  const host = '/cloudsql/voidanchae:asia-northeast3:va-postgres';
  for (const extra of [{}, { DB_HOST: host, DB_PORT: '5432' }]) {
    const options = postgresPoolOptions({ ...cloudSql, ...extra, BACKEND_DB_POOL_SIZE: '4' });
    const client = new pg.Client(options) as unknown as { connectionParameters: {
      host: string; port: number; user: string; database: string; ssl: boolean; isDomainSocket: boolean;
    } };
    assert.equal(client.connectionParameters.host, host);
    assert.equal(client.connectionParameters.port, 5432);
    assert.equal(client.connectionParameters.user, 'application');
    assert.equal(client.connectionParameters.database, 'hosting_manager');
    assert.equal(client.connectionParameters.ssl, false);
    assert.equal(client.connectionParameters.isDomainSocket, true);
    assert.equal(options.connectionString, undefined);
    assert.equal(options.max, 4);
  }
});

test('Cloud SQL rejects stale URLs, hosts, ports and TLS settings without echoing credentials', () => {
  for (const extra of [
    { DATABASE_URL: 'postgresql://fixture:private-fixture-password@old.example/db' },
    { DB_HOST: 'old.example' }, { DB_HOST: '/tmp' }, { DB_PORT: '6543' },
    { BACKEND_DB_SSL: 'disable' }, { BACKEND_DB_SSL: 'require' }, { BACKEND_DB_SSL_CA: 'fixture-ca' },
  ]) {
    assert.throws(() => postgresPoolOptions({ ...cloudSql, ...extra }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Cloud SQL/);
      assert.ok(!error.message.includes('private-fixture-password'));
      assert.ok(!error.message.includes('old.example'));
      return true;
    });
  }
});

test('Cloud SQL requires explicit credentials and rejects malformed instance names', () => {
  for (const name of ['', '/cloudsql/voidanchae:asia-northeast3:va-postgres', 'voidanchae:asia-northeast3:../other',
    'voidanchae:asia-northeast3:va-postgres/other', 'voidanchae:asia-northeast3:va-postgres%2fother',
    'voidanchae:asia-northeast3:va-postgres:extra', 'voidanchae:asia-northeast3:va-postgres\n']) {
    assert.throws(() => postgresPoolOptions({ ...cloudSql, CLOUD_SQL_CONNECTION_NAME: name }), /project:region:instance/);
  }
  for (const key of ['DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    assert.throws(() => postgresPoolOptions({ ...cloudSql, [key]: '' }), /explicit DB_USER, DB_PASSWORD and DB_NAME/);
  }
  for (const max of ['0', '21', '1.5', 'NaN']) {
    assert.throws(() => postgresPoolOptions({ ...cloudSql, BACKEND_DB_POOL_SIZE: max }), /between 1 and 20/);
  }
});

test('socket configuration cannot silently select a different transport', () => {
  assert.throws(() => postgresPoolOptions({ ...cloudSql, BACKEND_DB_TRANSPORT: 'socket' }), /tcp or cloudsql-unix/);
  assert.throws(() => postgresPoolOptions({ ...cloudSql, BACKEND_DB_TRANSPORT: undefined }), /explicit cloudsql-unix/);
  assert.throws(() => postgresPoolOptions({ DB_HOST: '/cloudsql/voidanchae:asia-northeast3:va-postgres' }), /explicit cloudsql-unix/);
});

test('existing legacy pool defaults and TCP overrides remain unchanged', () => {
  assert.deepEqual(postgresPoolOptions({}), {
    host: 'aws-1-ap-northeast-1.pooler.supabase.com', port: 6543,
    database: 'postgres', user: 'postgres.hhftvzockfgigsfonivp', password: '',
    max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5000,
  });
  const options = postgresPoolOptions({ NODE_ENV: 'production', DB_HOST: 'db.example', DB_PORT: '5432',
    DB_USER: 'fixture', DB_PASSWORD: 'fixture-password', DB_NAME: 'fixture', DATABASE_URL: 'previously-ignored' });
  assert.equal(options.host, 'db.example');
  assert.equal(options.port, 5432);
  assert.equal(options.user, 'fixture');
  assert.equal(options.password, 'fixture-password');
  assert.equal(options.database, 'fixture');
  assert.equal(options.ssl, undefined);
  assert.equal(options.connectionString, undefined);
});

test('legacy backend database uses the same socket validation and its existing timeout', () => {
  const options = backendPoolOptions(cloudSql);
  assert.deepEqual(options, { ...postgresPoolOptions(cloudSql), idleTimeoutMillis: 30_000 });
  assert.throws(() => backendPoolOptions({ ...cloudSql, DATABASE_URL: 'postgresql://fixture:fixture@old.example/db' }), /Cloud SQL/);
  assert.throws(() => backendPoolOptions({ ...cloudSql, BACKEND_DB_TRANSPORT: 'unknown' }), /tcp or cloudsql-unix/);
  assert.throws(() => backendPoolOptions({ ...cloudSql, BACKEND_DB_TRANSPORT: undefined }), /explicit cloudsql-unix/);
});
