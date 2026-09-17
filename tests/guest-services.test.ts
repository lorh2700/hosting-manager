import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsManager, actAsCleaner, actAsAnonymous } from './stubs/auth';
import { makeRequest, callRoute } from './helpers/beds24-mock';
import { POST } from '../app/api/public/guest-services/route';
import { GET, PATCH } from '../app/api/guest-services/route';
import { guestGuide } from '../lib/guest-guide';
import { todayKst, addDaysToDateStr } from '../lib/dates';

let sequence=0;
const id='da822393-93be-49a6-8b1d-40b798b00001';
function payload(){return {id,slug:'byulha',guestName:'Test Guest',email:'guest@example.com',phone:'+44 7700 900000',arrivalDate:addDaysToDateStr(todayKst(),3),arrivalTime:'16:30',flightNumber:'KE902',passengers:3,luggage:2,message:'Two suitcases',language:'en',consent:true};}
function request(body:unknown,url='http://localhost/api/public/guest-services'){
  const req=makeRequest(body,url);req.headers.set('x-forwarded-for',`127.0.0.${++sequence}`);return req;
}
beforeEach(()=>{resetDb();actAsAdmin();db.property=[{id:'p1',slug:'byulha',name:'별하재',status:'active'},{id:'p2',slug:'dowonjae',name:'도원재',status:'active'}];});
test('픽업 접수는 로그인 없이 요청만 생성하며 가격은 서버 기준, 응답에 개인정보 없음',async()=>{
  actAsAnonymous();const result=await callRoute(POST,request(payload()));
  assert.equal(result.status,201);assert.deepEqual(result.body,{id,received:true});
  assert.equal(db.guestServiceRequest[0].quotedPrice,100000);assert.equal(db.guestServiceRequest[0].status,'requested');
  assert.equal(db.guestServiceRequest[0].propertyId,'p1');
});
test('응답 유실 재시도는 동일 요청을 반환하며 변경된 내용으로 같은 ID를 재사용할 수 없음',async()=>{
  await callRoute(POST,request(payload()));
  assert.equal((await callRoute(POST,request(payload()))).status,200);
  assert.equal((await callRoute(POST,request({...payload(),guestName:'Different'}))).status,409);
  assert.equal(db.guestServiceRequest.length,1);
});
test('잘못된 날짜·시간·인원·동의·가격 주입과 미지원 숙소를 거부',async()=>{
  for(const change of [{arrivalDate:'2027-02-30'},{arrivalTime:'25:00'},{passengers:1.5},{consent:false},{quotedPrice:1},{arrivalDate:'2020-01-01'},{website:'spam.example'}]){
    assert.equal((await callRoute(POST,request({...payload(),...change}))).status,400);
  }
  assert.equal((await callRoute(POST,request({...payload(),slug:'dowonjae'}))).status,404);
  assert.equal(guestGuide('dowonjae'),null);assert.equal(guestGuide('byeolha')?.slug,'byulha');
  assert.equal(db.guestServiceRequest?.length||0,0);
});
test('판매 중지 숙소에는 픽업 요청을 접수하지 않음',async()=>{
  db.property[0].status='closed';assert.equal((await callRoute(POST,request(payload()))).status,409);
});
test('중국어·일본어 픽업 요청은 선택 언어를 저장하고 미지원 언어는 거부',async()=>{
  for(const [index,language] of ['zh','ja'].entries()) {
    const requestId=`da822393-93be-49a6-8b1d-40b798b0000${index+5}`;
    const response=await callRoute(POST,request({...payload(),id:requestId,language}));
    assert.equal(response.status,201);
    assert.equal(db.guestServiceRequest.find(row=>row.id===requestId)?.language,language);
  }
  assert.equal((await callRoute(POST,request({...payload(),language:'unsupported'}))).status,400);
});
test('추가 숙소의 픽업은 해당 숙소에 귀속되고 다른 숙소에서 같은 접수 ID를 재사용할 수 없음',async()=>{
  for (const [index,slug] of ['anon','unwadang','hwayeonjae'].entries()) {
    const propertyId=`additional-${index}`;
    db.property.push({id:propertyId,slug,name:guestGuide(slug)!.name,status:'active'});
    const requestId=`da822393-93be-49a6-8b1d-40b798b0000${index+2}`;
    const result=await callRoute(POST,request({...payload(),id:requestId,slug}));
    assert.equal(result.status,201);
    assert.equal(db.guestServiceRequest.find(row=>row.id===requestId)?.propertyId,propertyId);
    assert.equal((await callRoute(POST,request({...payload(),id:requestId,slug:'byulha'}))).status,409);
  }
});
test('관리자 전체·매니저 담당 숙소만 조회, 청소직원과 비로그인 거부',async()=>{
  db.guestServiceRequest=[{id,propertyId:'p1',status:'requested',guestName:'A'},{id:'other',propertyId:'p2',status:'requested',guestName:'B'}];
  actAsManager(['p1']);let result=await callRoute(GET,request({},'http://localhost/api/guest-services'));
  assert.equal(result.status,200);assert.equal(result.body.total,1);assert.equal(result.body.rows[0].guestName,'A');
  actAsAdmin();result=await callRoute(GET,request({},'http://localhost/api/guest-services'));assert.equal(result.body.total,2);
  actAsCleaner(['p1']);assert.equal((await callRoute(GET,request({}))).status,403);
  actAsAnonymous();assert.equal((await callRoute(GET,request({}))).status,401);
});
test('확정 전 연락 단계를 요구하고 확정 메모·충돌 검사·숙소 권한 적용',async()=>{
  db.guestServiceRequest=[{id,propertyId:'p1',status:'requested',version:1}];
  const patch=(status:string,version:number,note='')=>callRoute(PATCH,request({id,status,version,internalNote:note}));
  actAsManager(['p2']);assert.equal((await patch('contacted',1)).status,403);
  actAsCleaner(['p1']);assert.equal((await patch('contacted',1)).status,403);
  actAsManager(['p1']);assert.equal((await patch('confirmed',1,'checked')).status,409);
  assert.equal((await patch('contacted',1)).status,200);
  assert.equal((await patch('cancelled',1)).status,409);
  assert.equal((await patch('confirmed',2)).status,400);
  assert.equal((await patch('confirmed',2,'Vehicle and final fare confirmed with guest')).status,200);
  assert.equal((await patch('cancelled',3)).status,200);
  assert.equal((await patch('confirmed',4,'reopen')).status,409);
});
test('실제 PostgreSQL: 단일 문장 마이그레이션·RLS·숙소 삭제 방지',async()=>{
  const pg=new PGlite();try{
    await pg.exec("CREATE TABLE properties(id TEXT PRIMARY KEY); INSERT INTO properties VALUES ('p1'); CREATE ROLE anon; CREATE ROLE authenticated;");
    await pg.query(await readFile(new URL('../prisma/migrations/20260918000000_guest_service_requests/migration.sql',import.meta.url),'utf8'));
    await pg.exec("INSERT INTO guest_service_requests(id,property_id,guest_name,email,phone,arrival_date,arrival_time,flight_number,passengers,luggage,quoted_price,request_hash) VALUES ('request','p1','Test','test@example.com','01000000000','2027-01-01','15:00','KE902',2,2,100000,'hash')");
    await assert.rejects(pg.exec("DELETE FROM properties WHERE id='p1'"));
    const r=await pg.query<{relrowsecurity:boolean}>("SELECT relrowsecurity FROM pg_class WHERE relname='guest_service_requests'");assert.equal(r.rows[0].relrowsecurity,true);
    await pg.exec('SET ROLE anon');await assert.rejects(pg.query('SELECT * FROM guest_service_requests'));
  }finally{await pg.close();}
});
