import { prisma } from '@/lib/prisma';
import { withAuth, readJson, str, fail, ok } from '@/lib/core/http';
import { cleaningCancellationReason } from '@/lib/cleaning-cancellation';
import { getNotifier } from '@/lib/notify';
import { todayKst } from '@/lib/dates';

export const POST = withAuth<{id:string}>('cleaning-application-cancel', async(req,{auth,params})=>{
 const body=await readJson(req);
 const reason=str(body,'reason',{required:true,max:500})!.trim();
 if(!reason)throw fail(400,'취소 사유를 입력해 주세요.');
 const userId=auth.session.userId;
 const result=await prisma.$transaction(async tx=>{
  const app=await tx.cleaningApplication.findUnique({where:{id:params.id},include:{cleaning:{include:{property:{select:{name:true,owner:{select:{phone:true}}}}}}}});
  if(!app)throw fail(404,'신청을 찾을 수 없습니다.');
  if(app.applicantId!==userId)throw fail(403,'본인이 신청한 청소만 취소할 수 있습니다.');
  if(app.status==='cancelled')return null;
  const blocked=cleaningCancellationReason(app,app.cleaning,userId);
  if(blocked)throw fail(409,blocked);
  const changed=await tx.cleaningApplication.updateMany({where:{id:app.id,applicantId:userId,status:app.status},data:{status:'cancelled',rejectedReason:reason,processedAt:new Date(),processedBy:userId}});
  if(!changed.count)throw fail(409,'신청 상태가 변경되었습니다. 새로고침 후 확인해 주세요.');
  if(app.status==='approved'){
   const released=await tx.cleaning.updateMany({where:{id:app.cleaningId,cleanerId:userId,assignmentType:'applied',status:'pending',completedAt:null,date:{gt:todayKst()}},data:{cleanerId:null,isOpen:true}});
   if(!released.count)throw fail(409,'배정 상태가 변경되었습니다. 새로고침 후 확인해 주세요.');
  }
  return {phone:app.cleaning.property.owner?.phone,name:app.applicantName||'청소 담당자',property:app.cleaning.property.name,date:app.cleaning.date};
 });
 let notificationFailed=false;
 if(result?.phone){
  try {
   const sent=await getNotifier().sendSms({to:result.phone,text:`[void anchae] 청소 신청 취소\n${result.name}님이 ${result.property} ${result.date} 청소 신청을 취소했습니다.\n사유: ${reason}\n캘린더에서 담당자 배정을 확인해 주세요.`});
   notificationFailed=!sent.ok;
  }catch{notificationFailed=true;}
  if(notificationFailed)console.error('[cleaning-cancel] host notification failed',{applicationId:params.id});
 }
 return ok({ok:true,notificationFailed});
});
