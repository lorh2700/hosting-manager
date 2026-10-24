import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server.js';
import nextConfig from '../next.config';
import { GET as manifest } from '../app/stay/[slug]/manifest.webmanifest/route';

test('existing Unwa QR URLs redirect permanently and preserve guest language and reservation query', async () => {
  for (const suffix of ['', '/manifest.webmanifest']) {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://voidanchae.com/stay/unwa${suffix}?lang=ko&accessToken=example-token`, nextConfig,
    });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), `https://voidanchae.com/stay/unwadang${suffix}?lang=ko&accessToken=example-token`);
  }
  const untouched = await unstable_getResponseFromNextConfig({ url: 'https://voidanchae.com/stay/anon', nextConfig });
  assert.equal(untouched.headers.get('location'), null);
});

test('legacy and canonical Unwa manifests use one canonical app identity', async () => {
  for (const slug of ['unwa', 'unwadang']) {
    const response = await manifest(new Request(`https://voidanchae.com/stay/${slug}/manifest.webmanifest`), { params: Promise.resolve({ slug }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.id, '/stay/unwadang');
    assert.equal(body.start_url, '/stay/unwadang');
  }
  assert.equal((await manifest(new Request('https://voidanchae.com/stay/unknown/manifest.webmanifest'), { params: Promise.resolve({ slug: 'unknown' }) })).status, 404);
});
