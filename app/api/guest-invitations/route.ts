import { withAuth,readJson,ok,fail,requireManage } from '@/lib/core/http';
import { z } from 'zod';
import { invitationReservation } from '@/lib/guest-invitation-reservation';
import { sealInvitation } from '@/lib/guest-invitation-token';
import { prisma } from '@/lib/prisma';
const schema=z.object({id:z.string().uuid(),language:z.enum(['ko','en','ja','zh']).default('ko')});
export const POST=withAuth('guest-invitations',async(req,{auth})=>{
 const body=schema.safeParse(await readJson(req));if(!body.success)throw fail(400,'예약 정보가 올바르지 않습니다.');
 const {id,language}=body.data;
 const event=await prisma.event.findUnique({where:{id},select:{propertyId:true}});
 const kind=event?'event':'booking';
 const owner=event||await prisma.booking.findUnique({where:{id},select:{propertyId:true}});
 if(!owner)throw fail(404,'예약을 찾을 수 없습니다.');requireManage(auth,owner.propertyId);
 const reservation=await invitationReservation(kind,id);if(!reservation)throw fail(400,'게스트 안내가 지원되는 숙소의 확정 예약과 예약자 이름을 확인해 주세요.');
 const expires=Math.min(Date.now()+365*86400000,Date.parse(`${reservation.checkOut}T00:00:00+09:00`)+30*86400000);
 if(!Number.isFinite(expires)||expires<=Date.now())throw fail(400,'초대장을 만들 수 있는 예약 기간이 지났습니다.');
 const token=sealInvitation({kind,id,propertyId:owner.propertyId,expires},process.env.JWT_SECRET||'');
 const response=ok({path:`/guest/welcome/${token}?lang=${language}`,guestName:reservation.guestName,expiresAt:new Date(expires).toISOString()});response.headers.set('Cache-Control','private, no-store');return response;
});
