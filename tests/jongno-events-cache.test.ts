import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/public/jongno-events/route';
import { resetDb } from './stubs/prisma';
import type { StubResponse } from './stubs/next-server';

beforeEach(() => { resetDb(); });

test('public event responses vary their shared cache by the entire query, including month and week boundaries', async () => {
  const queries = [
    ['month=2026-10', { from: '2026-10-01', to: '2026-10-31' }],
    ['month=2026-11', { from: '2026-11-01', to: '2026-11-30' }],
    ['from=2026-10-30&to=2026-11-05&category=palace&area=other&limit=1&cursor=next-page', { from: '2026-10-30', to: '2026-11-05' }],
  ] as const;
  for (const [query, range] of queries) {
    const response = await GET(new Request(`https://example.com/api/public/jongno-events?${query}`), { params: Promise.resolve({}) }) as unknown as StubResponse;
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.range, range);
    assert.equal(response.headers.get('Netlify-Vary'), 'query');
    assert.match(response.headers.get('Cache-Control') || '', /s-maxage=60/);
  }
});

test('the installed Netlify adapter preserves the event query variation alongside its framework variations', async () => {
  const runtimeHeaders = new URL('../node_modules/@netlify/plugin-nextjs/dist/run/headers.js', import.meta.url);
  const { setVaryHeaders } = await import(runtimeHeaders.href);
  const request = new Request('https://example.com/api/public/jongno-events?month=2026-11');
  const response = await GET(request, { params: Promise.resolve({}) });
  const headers = new Headers(response.headers);
  setVaryHeaders(headers, request, { basePath: '' });
  const variations = headers.get('Netlify-Vary')?.split(',') || [];
  assert.ok(variations.includes('query'), 'the CDN must distinguish business query parameters, not just _rsc');
  assert.ok(variations.some(value => value.startsWith('header=') && value.includes('rsc')));
  assert.ok(variations.some(value => value.startsWith('cookie=') && value.includes('__prerender_bypass')));
});
