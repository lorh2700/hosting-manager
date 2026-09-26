import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NextRequest } from 'next/server';
import { middleware } from '../middleware';
import { POST } from '../app/api/inquiry-automation/process/route';
import { callRoute } from './helpers/beds24-mock';
import { resetDb } from './stubs/prisma';

beforeEach(() => { resetDb(); process.env.CRON_SECRET = 'inquiry-cron-test'; });

function request(path = '/api/inquiry-automation/process', secret?: string) {
  const req = new Request(`https://example.com${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-cron-secret': secret } : {}) },
    body: JSON.stringify({ mode: 'seed' }),
  });
  Object.defineProperties(req, {
    nextUrl: { value: new URL(req.url) },
    cookies: { value: { get: () => undefined } },
  });
  return req as NextRequest;
}

test('cron without a login cookie reaches the authenticated inquiry worker', async () => {
  const req = request(undefined, 'inquiry-cron-test');
  assert.equal((await middleware(req)).status, 200);
  const result = await callRoute(POST, req);
  assert.equal(result.status, 200);
  assert.equal(result.body.queued, 0);
});

test('inquiry worker still rejects absent or incorrect cron secrets', async () => {
  for (const secret of [undefined, 'incorrect']) {
    const req = request(undefined, secret);
    assert.equal((await middleware(req)).status, 200);
    assert.equal((await callRoute(POST, req)).status, 401);
  }
});

test('cron exemption does not expose other admin or inquiry API routes', async () => {
  for (const path of ['/api/admin/calendar', '/api/inquiry-automation/process-extra', '/api/inquiry-automation/settings']) {
    assert.equal((await middleware(request(path, 'inquiry-cron-test'))).status, 401);
  }
});
