import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('CommonJS background functions load without ESM require support or web authentication', () => {
  const flags = Number(process.versions.node.split('.')[0]) >= 22 ? ['--no-experimental-require-module'] : [];
  const result = spawnSync(process.execPath, [...flags, fileURLToPath(new URL('./helpers/load-background-cjs.cjs', import.meta.url))], {
    encoding: 'utf8', timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /camera-inbox-background: loaded/);
  assert.match(result.stdout, /beds24-sync-background: loaded/);
  assert.match(result.stdout, /beds24-messages-background: loaded/);
});
