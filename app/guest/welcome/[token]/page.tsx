import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { openInvitation } from '@/lib/guest-invitation-token';
import { recoverInvitation } from '@/lib/guest-invitation-recovery';
import { invitationReservation, invitationPastStay } from '@/lib/guest-invitation-reservation';
import { guestLanguage } from '@/lib/guest-languages';
import GuestGuide from '../../[slug]/GuestGuide';
export const dynamic='force-dynamic';
export const revalidate=0;
export const metadata:Metadata={title:'Your invitation · void anchae',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function Page({params,searchParams}:{params:Promise<{token:string}>;searchParams:Promise<{lang?:string}>}){
 const {token}=await params;const ref=openInvitation(token,process.env.JWT_SECRET||'')||recoverInvitation(token);if(!ref)notFound();
 const reservation=await invitationReservation(ref.kind,ref.id);
 if(!reservation||reservation.propertyId!==ref.propertyId||invitationPastStay(reservation.checkOut))notFound();
 const {lang}=await searchParams;const {guide,guestName,checkIn,checkOut,guests}=reservation;
 return <GuestGuide guide={guide} initialLanguage={guestLanguage(lang)} reservation={{guestName,checkIn,checkOut,guests}} invitationKey={`${ref.kind}:${ref.id}`}/>;
}
