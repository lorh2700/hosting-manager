import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/guest-invitations/route';
import { resolveInvitation } from '../lib/guest-invitation-access';
import { db, resetDb, prismaOverrides } from './stubs/prisma';
import { installGuestLinkRegistry } from './helpers/guest-link-registry';
import type { StubResponse } from './stubs/next-server';
import { actAsAdmin, actAsManager } from './stubs/auth';

const id = 'b83faeba-3648-4a80-9440-b5b7c595caca';
const propertyId = 'oKWKVQqLy7uENyHUwljr';
let registry: ReturnType<typeof installGuestLinkRegistry>;
beforeEach(() => {
  resetDb(); actAsAdmin();
  registry = installGuestLinkRegistry();
  db.property = [{ id: propertyId, slug: 'unwadang' }];
  db.event = [{ id, propertyId, title: 'Test Guest', type: 'reservation', channelId: 'beds24',
    startDate: '2099-10-25', endDate: '2099-10-27', numAdults: 2, numChildren: 0 }];
});
afterEach(async () => { await registry.close(); });
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
  assert.ok(url.href.length <= 60);
  assert.match(url.pathname, /^\/i\/i2_[A-Za-z0-9_-]{22}$/);
  assert.equal(url.searchParams.get('lang'), 'en');
  const ref = await resolveInvitation(url.pathname.split('/').at(-1)!);
  assert.equal(ref?.id, id);
  assert.equal(ref?.propertyId, propertyId);
});
test('new invitation issuance and resolution do not require JWT_SECRET', async () => {
  const previous = process.env.JWT_SECRET;
  try {
    delete process.env.JWT_SECRET;
    const response = await request();
    assert.equal(response.status, 200);
    const url = new URL((response as unknown as StubResponse).body.path, 'https://voidanchae.com');
    const token = url.pathname.split('/').at(-1)!;
    assert.equal((await resolveInvitation(token))?.id, id);
    process.env.JWT_SECRET = 'rotated-session-key';
    assert.equal((await resolveInvitation(token))?.id, id);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});
test('registry write failure never returns a bearer link to the caller', async () => {
  prismaOverrides.$executeRaw = async () => { throw new Error('registry unavailable'); };
  prismaOverrides.$queryRaw = async () => { throw new Error('registry unavailable'); };
  const response = await request() as unknown as StubResponse;
  assert.equal(response.status, 500);
  assert.equal(response.body.path, undefined);
});
test('legacy property IDs do not bypass property access checks', async () => {
  actAsManager(['another-property']);
  assert.equal((await request()).status, 403);
});
