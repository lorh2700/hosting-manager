import { prisma } from '@/lib/prisma';
import { guestGuide } from '@/lib/guest-guide';
import type { GuestInvitationReference } from '@/lib/guest-invitation-token';
export async function invitationReservation(kind:GuestInvitationReference['kind'],id:string){
 const property={select:{id:true,slug:true}};
 if(kind==='booking'){
  const b=await prisma.booking.findUnique({where:{id},select:{property,name:true,checkIn:true,checkOut:true,guests:true,status:true}});
  if(!b||b.status!=='confirmed')return null;
  const guide=guestGuide(b.property.slug||'');if(!guide||!b.name?.trim())return null;
  return {propertyId:b.property.id,guide,guestName:b.name.trim(),checkIn:b.checkIn,checkOut:b.checkOut,guests:b.guests};
 }
 const e=await prisma.event.findUnique({where:{id},select:{property,title:true,type:true,source:true,channelId:true,startDate:true,endDate:true,numAdults:true,numChildren:true}});
 // Synced confirmed stays only; iCal titles can contain private free text.
 if(!e||e.type!=='reservation'||e.source==='maintenance'||!['beds24','direct'].includes(e.channelId||''))return null;
 const guide=guestGuide(e.property.slug||'');const name=e.title?.replace(/\s+예약$/,'').trim();
 if(!guide||!name||name.startsWith('[문의]'))return null;
 return {propertyId:e.property.id,guide,guestName:name,checkIn:e.startDate,checkOut:e.endDate,guests:e.numAdults===null?null:e.numAdults+(e.numChildren||0)};
}

export function invitationPastStay(checkOut:string){const end=Date.parse(`${checkOut}T00:00:00+09:00`);return !Number.isFinite(end)||Date.now()>end+30*86400000;}
