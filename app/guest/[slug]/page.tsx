import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { guestGuide } from '@/lib/guest-guide';
import GuestGuide from './GuestGuide';
import { guestLanguage } from '@/lib/guest-languages';

export const metadata: Metadata = { title: 'Before you arrive · void anchae', description: 'Your stay essentials, airport pickup requests and local experiences.', robots: {index:false,follow:false} };
export default async function Page({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<{lang?:string}>}) {
  const {slug}=await params;
  const guide=guestGuide(slug);
  if(!guide) notFound();
  const {lang}=await searchParams;
  return <GuestGuide guide={guide} initialLanguage={guestLanguage(lang)}/>;
}
