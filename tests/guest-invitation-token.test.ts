import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, hkdfSync } from 'node:crypto';
import { sealInvitation,openInvitation } from '../lib/guest-invitation-token';
const secret='test-only-secret-do-not-use-in-production';
const ref={kind:'event' as const,id:'b83faeba-3648-4a80-9440-b5b7c595caca',propertyId:'1558727b-3aa2-4755-9cd6-7a553d3bd01d',expires:2000000000000};
test('legacy property IDs generate compact links for both reservation kinds',()=>{
 for(const propertyId of ['70X0HKDJasPU3RQj67aU','Z4jFeng2zG9WpAhWtow3','5plQsEOe9sTHzSsMS0pc','oKWKVQqLy7uENyHUwljr']){
  for(const kind of ['event','booking'] as const){
   const value={...ref,propertyId,kind};const token=sealInvitation(value,secret);
   assert.ok(token.startsWith('v3_'));assert.ok(token.length<105);
   assert.deepEqual(openInvitation(token,secret,1000),value);
   assert.equal(openInvitation(token,secret,ref.expires),null);
   assert.equal(openInvitation(token,'wrong-secret',1000),null);
   const raw=Buffer.from(token.slice(3),'base64url');raw[30]^=1;
   assert.equal(openInvitation('v3_'+raw.toString('base64url'),secret,1000),null);
  }
 }
 assert.throws(()=>sealInvitation({...ref,propertyId:'../invalid'},secret));
});
test('tokens encrypt references with unique random nonces',()=>{const a=sealInvitation(ref,secret),b=sealInvitation(ref,secret);assert.notEqual(a,b);assert.deepEqual(openInvitation(a,secret,1000),ref);assert.ok(!Buffer.from(a,'base64url').toString().includes(ref.id));});
test('tampered and wrong-key tokens cannot reveal a reservation',()=>{const token=sealInvitation(ref,secret);const raw=Buffer.from(token.slice(3),'base64url');raw[30]^=1;assert.equal(openInvitation('v2_'+raw.toString('base64url'),secret,1000),null);assert.equal(openInvitation(token,'different-secret',1000),null);assert.equal(openInvitation(token.slice(3),secret,1000),null);});
test('expired and malformed invitations are rejected',()=>{const token=sealInvitation(ref,secret);assert.equal(openInvitation(token,secret,ref.expires),null);assert.equal(openInvitation('invalid',secret),null);assert.equal(openInvitation('a'.repeat(1100),secret),null);});

test('compact tokens round trip both reservation kinds in 95 URL-safe characters',()=>{
 for(const kind of ['event','booking'] as const){
  const value={...ref,kind,expires:2000000000123};const token=sealInvitation(value,secret);
  assert.equal(token.length,95);assert.match(token,/^v2_[A-Za-z0-9_-]+$/);
  assert.deepEqual(openInvitation(token,secret,1000),value);
  assert.equal(openInvitation(token.slice(0,-1),secret,1000),null);
 }
});

test('previous JSON-encrypted links remain readable without regeneration',()=>{
 const iv=Buffer.alloc(12,7);
 const key=Buffer.from(hkdfSync('sha256',secret,'void-anchae','guest-invitation-v1',32));
 const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('guest-invitation-v1'));
 const payload=Buffer.concat([cipher.update(JSON.stringify(ref),'utf8'),cipher.final()]);
 const token=Buffer.concat([iv,cipher.getAuthTag(),payload]).toString('base64url');
 assert.deepEqual(openInvitation(token,secret,1000),ref);
 assert.equal(openInvitation(token,secret,ref.expires),null);
 assert.equal(openInvitation(token.slice(0,-1),secret,1000),null);
});
