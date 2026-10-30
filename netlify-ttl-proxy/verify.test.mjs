import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./verify.mjs', import.meta.url));
test('static build validates routes and no function sources without application credentials', () => {
    const result = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].includes(key))), NETLIFY_NEXT_PLUGIN_SKIP: 'true' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /three static files, zero function sources, fixed upstream/);
});

test('build fails closed when the Next runtime skip is absent or incorrect', () => {
    for (const value of [undefined, 'false', '1']) {
        const env = { ...process.env };
        delete env.NETLIFY_NEXT_PLUGIN_SKIP;
        if (value !== undefined) env.NETLIFY_NEXT_PLUGIN_SKIP = value;
        const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Next runtime must be disabled/);
    }
});
