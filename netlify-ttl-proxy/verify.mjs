import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
assert.equal(process.env.NETLIFY_NEXT_PLUGIN_SKIP, 'true', 'Next runtime must be disabled.');
const config = readFileSync(join(root, '..', 'netlify.toml'), 'utf8');
for (const expected of [
    'base = "netlify-ttl-proxy"',
    'command = "node verify.mjs"',
    'publish = "public"',
    'directory = "empty-functions"',
    'NETLIFY_NEXT_PLUGIN_SKIP = "true"',
]) assert.ok(config.includes(expected), `Missing static deploy setting: ${expected}`);
assert.ok(!/\[\[?\s*(?:plugins|edge_functions)|\bschedule\s*=/.test(config), 'Dynamic functions or plugins must not be configured.');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'scripts']) {
    assert.equal(Object.keys(pkg[key] || {}).length, 0, `Static proxy must not declare ${key}.`);
}
assert.deepEqual(readdirSync(join(root, 'empty-functions')), ['.gitkeep']);
assert.deepEqual(readdirSync(join(root, 'public')).sort(), ['_redirects', 'index.html', 'proxy-deployment.txt']);
assert.ok(!/<script\b/i.test(readFileSync(join(root, 'public', 'index.html'), 'utf8')));
const redirects = readFileSync(join(root, 'public', '_redirects'), 'utf8').trim().split(/\r?\n/);
assert.deepEqual(redirects, [
    'https://www.voidanchae.com/* https://voidanchae.com/:splat 301!',
    '/ical/anon https://api.beds24.com/ical/bookings.ics?roomid=665802 301',
    '/ical/anonjae https://api.beds24.com/ical/bookings.ics?roomid=665802 301',
    '/ical/hwayeonjae https://api.beds24.com/ical/bookings.ics?roomid=667806 301',
    '/ical/unwadang https://api.beds24.com/ical/bookings.ics?roomid=664844 301',
    '/ical/byulha https://api.beds24.com/ical/bookings.ics?roomid=704756 301',
    '/* https://hosting-manager-legacy-ato3js2aoq-du.a.run.app/:splat 200!',
]);
console.log('TTL proxy verified: three static files, zero function sources, fixed upstream.');
