import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { backendPoolOptions } from '../packages/data/backend-client';
import { backendConfig } from '../services/api/config';

const base = 'postgresql://test:test@localhost:5432/isolated';
test('production database rejects all disabled or ambiguous TLS URL forms before a connection is created', () => {
  for (const suffix of ['?ssl=false', '?ssl=0', '?ssl=off', '?sslmode=disable', '?sslmode=no-verify', '?ssl=true&ssl=0', '?sslmode=verify-full&sslmode=disable', '?ssl=1&%73sl=0']) {
    assert.throws(() => backendPoolOptions({ NODE_ENV: 'production', DATABASE_URL: base + suffix }), /verified TLS/, suffix);
  }
  assert.throws(() => backendPoolOptions({ NODE_ENV: 'production', DATABASE_URL: base, BACKEND_DB_SSL: 'disable' }), /cannot be disabled/);
});

test('effective pg configuration enables verified production TLS with or without explicit URL options', () => {
  for (const suffix of ['', '?ssl=true', '?ssl=1', '?sslmode=verify-full']) {
    const config = backendPoolOptions({ NODE_ENV: 'production', DATABASE_URL: base + suffix });
    const client = new pg.Client(config) as unknown as { connectionParameters: { ssl: boolean | { rejectUnauthorized?: boolean } } };
    const ssl = client.connectionParameters.ssl;
    assert.notEqual(ssl, false, suffix);
    if (typeof ssl === 'object') assert.notEqual(ssl.rejectUnauthorized, false, suffix);
    assert.equal(config.max, 3);
  }
});

test('API config requires server credentials and a secure production web origin', () => {
  const env = { NODE_ENV: 'test', BACKEND_BRIDGE_SECRET: 'a'.repeat(32), JWT_SECRET: 'legacy-test-secret' } as NodeJS.ProcessEnv;
  assert.equal(backendConfig(env).host, '127.0.0.1');
  assert.throws(() => backendConfig({ ...env, BACKEND_BRIDGE_SECRET: '' }), /32 characters/);
  assert.throws(() => backendConfig({ ...env, NODE_ENV: 'production' }), /HTTPS/);
  assert.throws(() => backendPoolOptions({ NODE_ENV: 'test' }), /Explicit/);
  assert.throws(() => backendPoolOptions({ NODE_ENV: 'test', DATABASE_URL: base, BACKEND_DB_POOL_SIZE: '100' }), /between 1 and 20/);
});
