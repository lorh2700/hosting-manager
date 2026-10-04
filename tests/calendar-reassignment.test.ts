import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {PUT,POST} from '../app/api/cleanings/route';
import {db,resetDb} from './stubs/prisma';
import {actAsAdmin} from './stubs/auth';
import {notifyCalls,resetNotify} from './stubs/notify';
beforeEach(()=>{resetDb();resetNotify();actAsAdmin();db.property=[{id:'p',name:'Test'}];db.user=['old','new'].map(id=>({id,displayName:id,phone:'01000000000',status:'active',role:'super_admin',publicToken:id,properties:[]}));db.cleaning=[{id:'c',propertyId:'p',date:'2026-10-02',cleanerId:'old',status:'pending'}];});
const req=(body:unknown)=>new Request('http://test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('reassignment cancels previous assignee and notifies new one exactly once',async()=>{
 const ctx={params:Promise.resolve({})};
 assert.equal((await PUT(req({id:'c',cleanerId:'new'}),ctx)).status,200);
 assert.equal(notifyCalls.cancelled.length,1);assert.equal(notifyCalls.cancelled[0].cleanerName,'old');assert.equal(notifyCalls.cancelled[0].reason,'reassigned');
 assert.equal(notifyCalls.assigned.length,1);
 await PUT(req({id:'c',cleanerId:'new'}),ctx);assert.equal(notifyCalls.cancelled.length,1);
});
test('stale unassigned screen cannot create duplicate record and bypass cancellation',async()=>{
 assert.equal((await POST(req({propertyId:'p',date:'2026-10-02',cleanerId:'new'}),{params:Promise.resolve({})})).status,409);
 assert.equal(db.cleaning.length,1);assert.equal(db.cleaning[0].cleanerId,'old');assert.equal(notifyCalls.cancelled.length,0);
});
