import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/ops/today/route';
import { db, calls, resetDb } from './stubs/prisma';
import { actAsAdmin } from './stubs/auth';
import { todayKst } from '../lib/dates';
import { readOps } from '../lib/read-ops';
const today = todayKst();
beforeEach(() => {
  resetDb(); actAsAdmin();
  db.property = [{ id: 'p', name: 'Test', roomReadyMessage: 'ready' }];
  db.event = [{ id: 'e', propertyId: 'p', title: 'Guest', type: 'reservation', tags: [], startDate: today, endDate: '2099-01-01', channelId: 'beds24' }];
});
const read = async (view: string) => {
  const response = await GET(new Request(`http://test/api/ops/today?view=${view}`), { params: Promise.resolve({}) });
  return { status: response.status, body: (response as unknown as { body: any }).body };
};
test('summary returns reservations without reading optional tables', async () => {
  const { status, body } = await read('summary');
  assert.equal(status, 200); assert.equal(body.properties[0].checkins.length, 1);
  assert.equal(body.detailsLoaded, false); assert.equal(body.counts.pendingSupplies, null);
  assert.ok(!calls.some(c => /message|laundryBatch|cleaning\.|supplyTodo/.test(c)));
});
test('optional failure preserves checkins and reports unknown rather than zero', async () => {
  Object.defineProperty(db, 'supplyTodo', { configurable: true, get() { throw new Error('test outage'); } });
  try {
    const { status, body } = await read('details');
    assert.equal(status, 200); assert.equal(body.properties[0].checkins.length, 1);
    assert.ok(body.unavailable.includes('supplies')); assert.equal(body.counts.pendingSupplies, null);
  } finally { delete db.supplyTodo; }
});
test('messages are bounded per reservation while unread and older delivery remain accurate', async () => {
  db.property.push({id:'p2',name:'Second',roomReadyMessage:'ready'});
  db.event.push({...db.event[0],id:'e2',propertyId:'p2'});
  db.message = ['e','e2'].flatMap(eventId => Array.from({length:20}, (_,i) => ({
    id:`${eventId}-${i}`, eventId, type:'message', sender:i===0?'host':'guest', text:i===0?'ready':`text-${i}`,
    read:false, deliveryStatus:'sent', createdAt:new Date(2026,0,1,0,i),
  })));
  const { body } = await read('details');
  for (const p of body.properties) {
    const guest = p.checkins[0];
    assert.ok(!calls.some(c => c.startsWith('laundryBatch.')));
    assert.equal(guest.messages.length,4); assert.equal(guest.unread,19); assert.equal(guest.readyDelivery,'sent');
    assert.equal(guest.messages[0].text,'text-16');
  }
});
test('GET retries a transient server failure once', async t => {
  let calls=0;
  t.mock.method(globalThis,'fetch',async () => ++calls===1 ? new Response('',{status:503}) : Response.json({ok:true}));
  assert.deepEqual(await readOps('/test',new AbortController().signal),{ok:true}); assert.equal(calls,2);
});
test('authentication failure is explicit and not retried', async t => {
  let calls=0; t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('',{status:401});});
  await assert.rejects(readOps('/test',new AbortController().signal),/로그인이 만료/); assert.equal(calls,1);
});
test('timeouts retry only once; cancelled reads do not retry', async t => {
  let calls=0; t.mock.method(globalThis,'fetch',async()=>{calls++;throw new DOMException('timeout','TimeoutError');});
  await assert.rejects(readOps('/test',new AbortController().signal),/연결이 지연/); assert.equal(calls,2);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readOps('/test',controller.signal)); assert.equal(calls,2);
});

import { opsActionsBlocked } from '../lib/ops-freshness';
test('operations block on KST rollover, incomplete data or refresh failure', () => {
 const input={today:'2026-09-25',detailsLoaded:true,refreshing:false,loadError:false};
 const before=new Date('2026-09-25T14:59:59Z'), after=new Date('2026-09-25T15:00:00Z');
 assert.equal(opsActionsBlocked(input,before),false);
 assert.equal(opsActionsBlocked(input,after),true);
 for(const change of [{detailsLoaded:false},{refreshing:true},{loadError:true},{unavailable:['messages']},{unavailable:['cleaning']}]) assert.equal(opsActionsBlocked({...input,...change},before),true);
 assert.equal(opsActionsBlocked({...input,unavailable:['supplies']},before),false);
});

test('mobile detail view skips hidden card count queries', async () => {
  const { status, body } = await read('details&includeCounts=false');
  assert.equal(status,200);
  assert.equal(body.properties[0].checkins.length,1);
  assert.equal(body.counts.pendingApplications,null);
  assert.ok(!calls.some(c => ['cleaningApplication.count','cleaningIssue.count','supplyTodo.count'].includes(c)));
});
