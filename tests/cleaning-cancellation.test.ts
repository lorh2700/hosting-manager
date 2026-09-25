import { test,beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST as apply, GET as applications } from '../app/api/cleaning-applications/route';
import { notifyCalls, resetNotify } from './stubs/notify';
import { POST } from '../app/api/cleaning-applications/[id]/cancel/route';
import { cleaningCancellationReason } from '../lib/cleaning-cancellation';
import { db,resetDb } from './stubs/prisma';
import { actAsCleaner,actAsAnonymous } from './stubs/auth';
import { todayKst,addDaysToDateStr } from '../lib/dates';
const future=addDaysToDateStr(todayKst(),2);
beforeEach(()=>{resetDb();resetNotify();actAsCleaner(['p']);db.property=[{id:'p',name:'숙소',owner:{phone:'01000000000'}}];db.cleaning=[{id:'c',propertyId:'p',date:future,cleanerId:'cleaner-1',assignmentType:'applied',status:'pending',completedAt:null,isOpen:false}];db.cleaningApplication=[{id:'a',cleaningId:'c',propertyId:'p',applicantId:'cleaner-1',status:'approved'}];});
const cancel=(reason='일정 변경')=>POST(new Request('http://test/api/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})}),{params:Promise.resolve({id:'a'})});
test('self cancellation retains history, releases slot, and repeat is idempotent',async()=>{
 assert.equal((await cancel()).status,200);assert.equal(db.cleaningApplication[0].status,'cancelled');assert.equal(db.cleaningApplication[0].rejectedReason,'일정 변경');assert.equal(db.cleaning[0].cleanerId,null);assert.equal(db.cleaning[0].isOpen,true);assert.equal(notifyCalls.sms.length,1);
 db.cleaning[0].cleanerId='other';assert.equal((await cancel()).status,200);assert.equal(db.cleaning[0].cleanerId,'other');assert.equal(notifyCalls.sms.length,1);
});
test('anonymous and another applicant cannot cancel',async()=>{actAsAnonymous();assert.equal((await cancel()).status,401);actAsCleaner(['p']);db.cleaningApplication[0].applicantId='other';assert.equal((await cancel()).status,403);assert.equal(db.cleaning[0].cleanerId,'cleaner-1');});
test('today, completed, in-progress, manual and reassigned cleanings stay assigned',async()=>{
 for(const change of [{date:todayKst()},{status:'done'},{status:'in_progress'},{assignmentType:'direct'},{cleanerId:'other'}]){
  const original={...db.cleaning[0]};Object.assign(db.cleaning[0],change);assert.equal((await cancel()).status,409);assert.equal(db.cleaningApplication[0].status,'approved');db.cleaning[0]=original;
 }
 assert.equal((await cancel('  ')).status,400);
});
test('KST cutoff allows tomorrow but blocks same date',()=>{
 const app={applicantId:'u',status:'approved'},cleaning={cleanerId:'u',assignmentType:'applied',status:'pending',completedAt:null,date:'2026-10-23'};
 assert.equal(cleaningCancellationReason(app,cleaning,'u','2026-10-22'),null);
 assert.ok(cleaningCancellationReason(app,cleaning,'u','2026-10-23'));
});

test('cancelled history remains visible and does not prevent reapplication',async()=>{
 await cancel();
 const list=await applications(new Request('http://test/api/cleaning-applications?mine=true'),{params:Promise.resolve({})});
 const rows=(list as unknown as {body:{status:string;canCancel:boolean}[]}).body;assert.equal(rows[0].status,'cancelled');assert.equal(rows[0].canCancel,false);
 const response=await apply(new Request('http://test/api/cleaning-applications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cleaningId:'c'})}),{params:Promise.resolve({})});
 assert.equal(response.status,201);assert.equal(db.cleaning[0].cleanerId,'cleaner-1');assert.equal(db.cleaningApplication.length,2);
});

test('simultaneous cancel requests send only one notification',async()=>{
 const responses=await Promise.all([cancel(),cancel()]);
 assert.ok(responses.some(r=>r.status===200));
 assert.equal(notifyCalls.sms.length,1);
 assert.equal(db.cleaningApplication[0].status,'cancelled');
});

test('pending application withdrawal preserves the unassigned cleaning',async()=>{
 db.cleaningApplication[0].status='pending';db.cleaning[0].cleanerId=null;db.cleaning[0].isOpen=true;
 assert.equal((await cancel()).status,200);assert.equal(db.cleaning[0].isOpen,true);assert.equal(db.cleaning[0].cleanerId,null);
});
