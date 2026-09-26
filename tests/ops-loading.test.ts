import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpsSnapshotCache, mapOpsReads } from '../lib/ops-loading';
test('snapshot is scoped to account/permissions, expires, and never crosses KST midnight', () => {
 const cache = createOpsSnapshotCache<{today:string; value:number}>();
 const now=Date.parse('2026-09-26T10:00:00Z');
 cache.write('admin:p1',{today:'2026-09-26',value:1},now);
 assert.equal(cache.read('admin:p1',now+1000)?.data.value,1);
 assert.equal(cache.read('other:p1',now),null);
 assert.equal(cache.read('admin:p2',now),null);
 assert.equal(cache.read('admin:p1',now+60000),null);
 const midnight=Date.parse('2026-09-26T15:00:00Z');
 cache.write('admin:p1',{today:'2026-09-26',value:1},midnight-1000);
 assert.equal(cache.read('admin:p1',midnight),null);
 cache.clear();assert.equal(cache.read('admin:p1',now),null);
});
test('bounded reads overlap without exceeding two active queries and preserve order', async () => {
 let active=0,peak=0;
 const result=await mapOpsReads([1,2,3,4,5,6],async n=>{
  active++;peak=Math.max(peak,active);
  await new Promise(resolve=>setTimeout(resolve,5));
  active--;return n*2;
 });
 assert.equal(peak,2);assert.deepEqual(result,[2,4,6,8,10,12]);
 assert.deepEqual(await mapOpsReads([],async n=>n),[]);
});
