import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/public/welcomepad/cleanings/done/route';
import { db, calls, resetDb } from './stubs/prisma';
import { installBeds24Mock, resetFetch, postsTo } from './helpers/beds24-mock';
import { todayKst } from '../lib/dates';
process.env.WELCOMEPAD_API_KEY='test-pad-actions';
beforeEach(()=>{resetDb();resetFetch();installBeds24Mock();db.property=[{id:'p',welcomepadKey:'anon',name:'Test',roomReadyMessage:'Ready'}];});
const action=(body:Record<string,unknown>={})=>POST(new Request('http://test',{method:'POST',headers:{'x-api-key':'test-pad-actions','Content-Type':'application/json'},body:JSON.stringify({propertyKey:'anon',...body})}));
test('no schedule and legacy pad requests never create a completed cleaning',async()=>{
 assert.equal((await action()).status,409);assert.ok(!calls.includes('cleaning.create'));assert.equal(postsTo('/bookings/messages').length,0);
});
test('completion only updates assigned schedule and never sends messages',async()=>{
 db.cleaning=[{id:'c',propertyId:'p',date:todayKst(),status:'pending',cleanerId:'u',completedAt:null},{id:'ghost',propertyId:'p',date:todayKst(),status:'pending',cleanerId:null}];
 assert.equal((await action({action:'complete'})).status,200);assert.equal(db.cleaning[0].status,'done');assert.equal(db.cleaning[1].status,'pending');
 const at=db.cleaning[0].completedAt;await action({action:'complete'});assert.equal(db.cleaning[0].completedAt,at);assert.equal(postsTo('/bookings/messages').length,0);
});
test('message-only action sends to today arrival without any cleaning writes',async()=>{
 db.event=[{id:'e',propertyId:'p',channelId:'beds24',type:'reservation',startDate:todayKst(),originalUid:'123',title:'Guest'}];
 const result=await action({action:'send_message'});assert.equal(result.status,200);
 assert.equal((result as unknown as {body:{message:{status:string}}}).body.message.status,'sent');
 assert.equal(postsTo('/bookings/messages').length,1);assert.ok(!calls.some(c=>c.startsWith('cleaning.')));
});
test('ambiguous schedules and stale dates cannot mutate records',async()=>{
 db.cleaning=['a','b'].map(id=>({id,propertyId:'p',date:todayKst(),status:'pending',cleanerId:id}));
 assert.equal((await action()).status,409);assert.equal((await action({date:'2000-01-01'})).status,409);assert.ok(db.cleaning.every(c=>c.status==='pending'));
});
