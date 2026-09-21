import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealInvitation,openInvitation } from '../lib/guest-invitation-token';
const secret='test-only-secret-do-not-use-in-production';
const ref={kind:'event' as const,id:'b83faeba-3648-4a80-9440-b5b7c595caca',propertyId:'1558727b-3aa2-4755-9cd6-7a553d3bd01d',expires:2000000000000};
test('tokens encrypt references with unique random nonces',()=>{const a=sealInvitation(ref,secret),b=sealInvitation(ref,secret);assert.notEqual(a,b);assert.deepEqual(openInvitation(a,secret,1000),ref);assert.ok(!Buffer.from(a,'base64url').toString().includes(ref.id));});
test('tampered and wrong-key tokens cannot reveal a reservation',()=>{const token=sealInvitation(ref,secret);const raw=Buffer.from(token,'base64url');raw[30]^=1;assert.equal(openInvitation(raw.toString('base64url'),secret,1000),null);assert.equal(openInvitation(token,'different-secret',1000),null);});
test('expired and malformed invitations are rejected',()=>{const token=sealInvitation(ref,secret);assert.equal(openInvitation(token,secret,ref.expires),null);assert.equal(openInvitation('invalid',secret),null);assert.equal(openInvitation('a'.repeat(1100),secret),null);});
