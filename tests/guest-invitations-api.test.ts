import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/guest-invitations/route';
import { openInvitation } from '../lib/guest-invitation-token';
import { db, resetDb } from './stubs/prisma';
import type { StubResponse } from './stubs/next-server';
import { actAsAdmin, actAsManager } from './stubs/auth';

const id = 'b83faeba-3648-4a80-9440-b5b7c595caca';
const propertyId = 'oKWKVQqLy7uENyHUwljr';
beforeEach(() => {
  resetDb(); actAsAdmin();
  db.property = [{ id: propertyId, slug: 'unwadang' }];
  db.event = [{ id, propertyId, title: 'Test Guest', type: 'reservation', channelId: 'beds24',
    startDate: '2099-10-25', endDate: '2099-10-27', numAdults: 2, numChildren: 0 }];
});
function request() {
  return POST(new Request('http://localhost/api/guest-invitations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, language: 'en' }),
  }), { params: Promise.resolve({}) });
}
test('invitation button returns a usable short link for a legacy property ID', async () => {
  const response = await request();
  assert.equal(response.status, 200);
  const body = (response as unknown as StubResponse).body;
  const url = new URL(body.path, 'https://voidanchae.com');
  assert.ok(url.href.length <= 146);
  assert.equal(url.searchParams.get('lang'), 'en');
  const ref = openInvitation(url.pathname.split('/').at(-1)!, process.env.JWT_SECRET!);
  assert.equal(ref?.id, id);
  assert.equal(ref?.propertyId, propertyId);
});
test('legacy property IDs do not bypass property access checks', async () => {
  actAsManager(['another-property']);
  assert.equal((await request()).status, 403);
});
