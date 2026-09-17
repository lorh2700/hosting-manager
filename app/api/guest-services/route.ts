import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withAuth, readJson, ok, fail, visibleScope, requireManage } from '@/lib/core/http';
import { serviceStatuses, serviceTransitions } from '@/lib/guest-guide';

export const GET = withAuth('guest-services/list', async (req, {auth}) => {
  if (auth.role==='cleaner') throw fail(403, '관리 권한이 필요합니다.');
  const params = new URL(req.url).searchParams;
  const page = Math.max(1, Math.min(10000, Math.floor(Number(params.get('page')) || 1)));
  const status = params.get('status');
  if (status && !serviceStatuses.includes(status as typeof serviceStatuses[number])) throw fail(400, '상태를 확인해 주세요.');
  const ids = await visibleScope(auth);
  const where = { ...(ids===null ? {} : {propertyId: {in: ids}}), ...(status ? {status} : {}) };
  const [rows,total] = await Promise.all([
    prisma.guestServiceRequest.findMany({where, orderBy:[{createdAt:'desc'},{id:'desc'}], skip:(page-1)*30,take:30,
      select:{id:true,propertyId:true,guestName:true,email:true,phone:true,arrivalDate:true,arrivalTime:true,flightNumber:true,passengers:true,luggage:true,message:true,language:true,status:true,quotedPrice:true,internalNote:true,version:true,createdAt:true,property:{select:{name:true}}}}),
    prisma.guestServiceRequest.count({where}),
  ]);
  const response=ok({rows,total,page}); response.headers.set('Cache-Control','private, no-store'); return response;
});
const update = z.object({id:z.string().uuid(),version:z.number().int().positive(),status:z.enum(serviceStatuses),internalNote:z.string().trim().max(2000)}).strict();
export const PATCH = withAuth('guest-services/update', async (req,{auth}) => {
  const parsed=update.safeParse(await readJson(req));
  if(!parsed.success) throw fail(400,'변경 내용을 확인해 주세요.');
  const input=parsed.data;
  const row=await prisma.guestServiceRequest.findUnique({where:{id:input.id}});
  if(!row) throw fail(404,'요청을 찾을 수 없습니다.');
  requireManage(auth,row.propertyId);
  if(row.version!==input.version) throw fail(409,'다른 담당자가 수정했습니다. 새로고침 후 확인해 주세요.');
  const current=serviceStatuses.find(s=>s===row.status);
  if(!current || (current!==input.status && !serviceTransitions[current].includes(input.status))) throw fail(409,'허용되지 않는 상태 변경입니다.');
  if(input.status==='confirmed' && !input.internalNote) throw fail(400,'차량·요금·고객 안내 등 확인 내용을 메모에 남겨 주세요.');
  const result=await prisma.guestServiceRequest.updateMany({where:{id:input.id,version:input.version},data:{status:input.status,internalNote:input.internalNote,version:input.version+1}});
  if(result.count!==1) throw fail(409,'다른 담당자가 수정했습니다. 새로고침 후 확인해 주세요.');
  return ok({ok:true});
});
