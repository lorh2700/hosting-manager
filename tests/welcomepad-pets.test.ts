import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/public/welcomepad/checkins/route';
import { db, resetDb } from './stubs/prisma';
import { todayKst, addDaysToDateStr } from '../lib/dates';
process.env.WELCOMEPAD_API_KEY='test-pad-pets';
const today=todayKst(), departure=addDaysToDateStr(today,2);
beforeEach(()=>{
 resetDb();
 db.property=[{id:'p',welcomepadKey:'anon',beds24PropId:'10'}];
 db.event=[{propertyId:'p',originalUid:'123',channelId:'beds24',type:'reservation',title:'Guest',startDate:today,endDate:departure}];
});
async function guest(){
 const res=await GET(new Request(`http://test/api/public/welcomepad/checkins?propertyKey=anon&date=${today}`,{headers:{'x-api-key':'test-pad-pets'}}));
 assert.equal(res.status,200);
 return (res as unknown as {body:{guest:{pets?:number|null}}}).body.guest;
}
test('pad includes pet count from matching reservation options',async()=>{
 db.booking=[{propertyId:'p',status:'confirmed',checkIn:today,checkOut:departure,channelBookingRef:'123',checkout:{beds24Id:'123',stayOptions:{version:1,baseGuests:2,basePriceKrw:100000,extraGuests:0,extraGuestFeeKrw:0,pets:2,petFeeKrw:100000}}}];
 assert.equal((await guest()).pets,2);
});
test('pad does not infer pets from another booking or absent options',async()=>{
 db.booking=[{propertyId:'p',status:'confirmed',checkIn:today,checkOut:departure,channelBookingRef:'other',checkout:{beds24Id:'other',stayOptions:{pets:2}}}];
 assert.equal((await guest()).pets,null);
 db.booking=[];assert.equal((await guest()).pets,null);
});
