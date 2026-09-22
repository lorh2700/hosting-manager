const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  if (id === 'jose' || id === 'next/headers') throw new Error('Background job must not load session authentication: ' + id);
  return resolve.call(this, id.startsWith('@/') ? path.join(root, id.slice(2)) : id, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
delete process.env.JWT_SECRET;
delete process.env.CRON_SECRET;
(async () => {
  for (const name of ['camera-inbox-background', 'beds24-sync-background']) {
    const handler = require(path.join(root, 'netlify/functions', name + '.ts')).default;
    const response = await handler(new Request('http://localhost/'));
    assert.equal(response.status, 401);
    console.log(name + ': loaded without web auth; unauthorized request rejected');
  }
  process.env.URL = 'https://example.invalid';
  process.env.CRON_SECRET = 'test-only-cron-secret';
  const messages = require(path.join(root, 'netlify/functions/beds24-messages-background.ts')).default;
  const response = await messages(new Request('http://localhost/'));
  assert.equal(response.status, 401);
  console.log('beds24-messages-background: loaded without web auth; unauthorized request rejected');
})().catch(error => { console.error(error); process.exitCode = 1; });
