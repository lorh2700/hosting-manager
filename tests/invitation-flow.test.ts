import test from 'node:test';
import assert from 'node:assert/strict';
import { completeInvitation } from '../app/invite/[token]/invitation-flow';

function responses(items: { status?: number; body: object }[]) {
  const calls: string[] = [];
  const request = (async (url: unknown) => { calls.push(String(url)); const next = items.shift(); if (!next) throw new Error('Unexpected request'); return new Response(JSON.stringify(next.body), { status: next.status || 200 }); }) as typeof fetch;
  return { request, calls };
}
const invitation = { token: 'sample-token', email: 'owner@example.invalid', role: 'admin' };
test('a matching signed-in account must claim the invitation explicitly', async () => {
  const fake = responses([{ body: { success: true, profile: { role: 'admin' } } }]);
  assert.deepEqual(await completeInvitation({ ...invitation, signedInEmail: 'OWNER@example.invalid', request: fake.request }), { role: 'admin' });
  assert.deepEqual(fake.calls, ['/api/invitations/sample-token/accept']);
});
test('a different account never claims or silently switches business', async () => {
  const fake = responses([]);
  await assert.rejects(completeInvitation({ ...invitation, signedInEmail: 'someone@example.invalid', request: fake.request }), /초대받은 이메일/); assert.deepEqual(fake.calls, []);
});
test('new registration already consumes the invitation atomically', async () => {
  const fake = responses([{ body: { user: { id: 'new-user' }, profile: { role: 'cleaner' } } }]);
  assert.deepEqual(await completeInvitation({ ...invitation, password: 'sample-password', request: fake.request }), { role: 'cleaner' });
  assert.deepEqual(fake.calls, ['/api/auth/register']);
});
test('an existing email logs in and then claims the invitation before reporting completion', async () => {
  const fake = responses([{ status: 409, body: { error: '이미 등록된 이메일' } }, { body: { user: { id: 'existing-user' } } }, { body: { success: true, profile: { role: 'admin' } } }]);
  assert.deepEqual(await completeInvitation({ ...invitation, password: 'existing-password', request: fake.request }), { role: 'admin' });
  assert.deepEqual(fake.calls, ['/api/auth/register', '/api/auth/login', '/api/invitations/sample-token/accept']);
});
test('successful login alone never counts as accepting a denied invitation', async () => {
  const fake = responses([{ status: 409, body: { error: '이미 등록된 이메일' } }, { body: { user: { id: 'existing-user' } } }, { status: 403, body: { error: '다른 사업자에 속한 계정입니다.' } }]);
  await assert.rejects(completeInvitation({ ...invitation, password: 'existing-password', request: fake.request }), /다른 사업자/);
  assert.equal(fake.calls.at(-1), '/api/invitations/sample-token/accept');
});
test('an ambiguous success response is not treated as a completed invitation claim', async () => {
  const fake = responses([{ body: {} }]);
  await assert.rejects(completeInvitation({ ...invitation, signedInEmail: invitation.email, request: fake.request }), /초대를 수락하지/);
});
