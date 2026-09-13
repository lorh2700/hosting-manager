import { prisma } from '@/lib/prisma';
import { withAuth,ok,created,fail,readJson,visibleScope } from '@/lib/core/http';
import { laundryDate,createLaundry,laundryItems,laundryStatus,receiveLaundry } from '@/lib/laundry';
import { z } from 'zod';

export const GET=withAuth('laundry',async(req,{auth})=>{
  const ids=await visibleScope(auth);const url=new URL(req.url);const propertyId=url.searchParams.get('propertyId');
  if(propertyId&&ids!==null&&!ids.includes(propertyId))throw fail(403,'담당 숙소만 조회할 수 있습니다.');
  const where=propertyId?{propertyId}:ids===null?{}:{propertyId:{in:ids}};
  const batches=await prisma.laundryBatch.findMany({where,include:{property:{select:{name:true}}},orderBy:{pickupDate:'desc'},take:300});
  const properties=await prisma.property.findMany({where:ids===null?{}:{id:{in:ids}},select:{id:true,name:true},orderBy:{name:'asc'}});
  return ok({batches,properties});
});
export const POST=withAuth('laundry',async(req,{auth})=>{
  const parsed=createLaundry.safeParse(await readJson(req));if(!parsed.success)throw fail(400,parsed.error.issues[0].message);
  const data=parsed.data,ids=await visibleScope(auth);
  if(ids!==null&&!ids.includes(data.propertyId))throw fail(403,'담당 숙소만 등록할 수 있습니다.');
  if(!await prisma.property.findUnique({where:{id:data.propertyId},select:{id:true}}))throw fail(404,'숙소를 찾을 수 없습니다.');
  const old=await prisma.laundryBatch.findUnique({where:{id:data.id}});
  if(old){if(old.createdBy!==auth.session.userId||old.propertyId!==data.propertyId)throw fail(409,'이미 등록된 요청입니다.');return ok(old);}
  return created(await prisma.laundryBatch.create({data:{...data,createdBy:auth.session.userId,history:[{at:new Date().toISOString(),actorId:auth.session.userId,actor:auth.user.displayName||auth.user.email,action:'등록',items:data.items}]}}));
});
const update=z.object({id:z.string().uuid(),version:z.number().int().positive(),action:z.enum(['collect','washing','shipping','receive','correct','cancel','schedule']),schedule:z.object({pickupDate:laundryDate,deliveryDate:laundryDate,vendor:z.string().trim().min(1).max(100),vendorPhone:z.string().max(40),notes:z.string().max(2000)}).refine(v=>v.deliveryDate>=v.pickupDate).optional(),note:z.string().max(2000).default(''),items:laundryItems.optional(),incoming:z.array(z.object({name:z.string(),quantity:z.number(),damaged:z.number().default(0),rewash:z.number().default(0)})).max(30).optional()});
export const PATCH=withAuth('laundry',async(req,{auth})=>{
  const parsed=update.safeParse(await readJson(req));if(!parsed.success)throw fail(400,'입력값을 확인해주세요.');
  const input=parsed.data,ids=await visibleScope(auth);
  return ok(await prisma.$transaction(async tx=>{
    const batch=await tx.laundryBatch.findUnique({where:{id:input.id}});if(!batch)throw fail(404,'수거 건을 찾을 수 없습니다.');
    if(ids!==null&&!ids.includes(batch.propertyId))throw fail(403,'담당 숙소만 수정할 수 있습니다.');
    if(batch.version!==input.version)throw fail(409,'다른 담당자가 수정했습니다. 새로고침 후 확인해주세요.');
    let items=laundryItems.parse(batch.items),status=batch.status;const now=new Date();let collectedAt=batch.collectedAt,completedAt=batch.completedAt;
    if(input.action==='collect'){if(status!=='scheduled')throw fail(409,'수거 예정 건만 수거 완료할 수 있습니다.');status='collected';collectedAt=now;}
    if(input.action==='washing'||input.action==='shipping'){if(!['collected','washing','shipping','partial'].includes(status))throw fail(409,'수거 완료 후 변경해주세요.');status=input.action;}
    if(input.action==='receive'){
      if(!['collected','washing','shipping','partial'].includes(status))throw fail(409,'입고 대기 건만 처리할 수 있습니다.');
      try{items=receiveLaundry(items,input.incoming||[]);}catch(e){throw fail(400,(e as Error).message);}
      status=laundryStatus(items);completedAt=status==='completed'?now:null;
    }
    if(input.action==='correct'){
      if(!input.note.trim()||!input.items||status==='cancelled')throw fail(400,'정정 수량과 사유를 입력해주세요.');
      items=input.items;if(status==='scheduled'&&items.some(i=>i.received>0))throw fail(400,'수거 전에는 입고할 수 없습니다.');
      status=status==='scheduled'?'scheduled':laundryStatus(items);completedAt=status==='completed'?now:null;
    }
    if(input.action==='cancel'){if(status!=='scheduled')throw fail(409,'수거 전 일정만 취소할 수 있습니다.');if(!input.note.trim())throw fail(400,'취소 사유를 입력해주세요.');status='cancelled';}
    if(input.action==='schedule'&&(!input.schedule||['completed','cancelled'].includes(status)))throw fail(400,'진행 중인 세탁 일정만 수정할 수 있습니다.');
    const schedule=input.action==='schedule'?input.schedule:{};
    const history=Array.isArray(batch.history)?batch.history:[];
    const changed=await tx.laundryBatch.updateMany({where:{id:batch.id,version:input.version},data:{...schedule,status,items,collectedAt,completedAt,version:input.version+1,history:[...history,{at:now.toISOString(),actorId:auth.session.userId,actor:auth.user.displayName||auth.user.email,action:input.action,note:input.note,schedule,beforeSchedule:{pickupDate:batch.pickupDate,deliveryDate:batch.deliveryDate,vendor:batch.vendor,vendorPhone:batch.vendorPhone,notes:batch.notes},before:batch.items,items}]}});
    if(changed.count!==1)throw fail(409,'다른 담당자가 수정했습니다. 새로고침 후 확인해주세요.');
    return tx.laundryBatch.findUnique({where:{id:batch.id}});
  }));
});
