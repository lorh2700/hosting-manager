import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { currentSettlementMonth, getSettlementPeriod, cleaningSettlementTotals } from '../lib/cleaning-settlement';
import { GET } from '../app/api/cleanings/route';
import { db, resetDb } from './stubs/prisma';
import { actAsManager } from './stubs/auth';
beforeEach(()=>{resetDb();actAsManager(['p']);});
test('settlement rolls over on the 26th in KST including year boundary',()=>{
 for(const [time,start,end] of [
  ['2026-09-25T14:59:59Z','2026-08-26','2026-09-25'],
  ['2026-09-25T15:00:00Z','2026-09-26','2026-10-25'],
  ['2026-12-26T00:00:00Z','2026-12-26','2027-01-25'],
 ]){
  const period=getSettlementPeriod(currentSettlementMonth(new Date(time)));
  assert.equal(period.startStr,start);assert.equal(period.endStr,end);assert.equal(period.start.getHours(),0);
 }
});
test('unassigned completion never creates negative pending totals',()=>{
 assert.deepEqual(cleaningSettlementTotals([{cleanerId:null,status:'done'},{cleanerId:'u',status:'done'},{cleanerId:'u',status:'pending'}]),{done:2,pending:1,unassigned:1});
});
const read=(params:string)=>GET(new Request(`http://test/api/cleanings?${params}`),{params:Promise.resolve({})});
test('report date range includes both boundaries and preserves property permissions',async()=>{
 db.cleaning=[
  {id:'before',propertyId:'p',date:'2026-08-25'},
  {id:'start',propertyId:'p',date:'2026-08-26'},
  {id:'end',propertyId:'p',date:'2026-09-25'},
  {id:'after',propertyId:'p',date:'2026-09-26'},
  {id:'private',propertyId:'q',date:'2026-09-20'},
 ];
 const res=await read('dateFrom=2026-08-26&dateTo=2026-09-25');assert.equal(res.status,200);
 assert.deepEqual((res as unknown as {body:{id:string}[]}).body.map(c=>c.id),['end','start']);
 assert.equal((await read('dateFrom=2026-09-26&dateTo=2026-09-25')).status,400);
});
