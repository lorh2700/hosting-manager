'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowDown, ArrowUpRight, Check, Clock3, MapPin, Plane, Luggage, CarFront, Loader2 } from 'lucide-react';
import { todayKst, addDaysToDateStr } from '@/lib/dates';
import type { guestGuide } from '@/lib/guest-guide';
import { guestGuideCopy } from '@/lib/guest-guide-copy';
import { guestTourCopy } from '@/lib/guest-tour-copy';
import { guestLanguages, guestLanguageNames, type GuestLanguage } from '@/lib/guest-languages';

type Guide=NonNullable<ReturnType<typeof guestGuide>>;
type Tour={id:string;slug:string;title:string;description:string|null;images:string[];basePrice:number|null;durationMin:number|null};
const field='mt-2 min-h-12 w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-base text-stone-900 outline-none focus:border-[#31594c] focus:ring-2 focus:ring-[#31594c]/20';
const focus='focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#31594c]';

export default function GuestGuide({guide,initialLanguage}:{guide:Guide;initialLanguage:GuestLanguage}){
  const [lang,setLang]=useState<GuestLanguage>(initialLanguage); const base=guestGuideCopy[lang];
  const propertyName=lang==='ko'?guide.name:guide.nameEn;
  const t={...base,
    intro:base.intro.replace('{name}',propertyName),
    rideText:base.rideText.replace('{name}',propertyName),
    luggageText:guide.slug==='byulha'?base.luggageText:base.luggageOther,
    price:new Intl.NumberFormat(({ko:'ko-KR',en:'en-US',zh:'zh-CN',ja:'ja-JP'})[lang],{style:'currency',currency:'KRW',maximumFractionDigits:0}).format(guide.pickupPrice),
  };
  const [tours,setTours]=useState<Tour[]>([]),[tourLoading,setTourLoading]=useState(true),[tourError,setTourError]=useState(false),[attempt,setAttempt]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState<number|null>(null),[receipt,setReceipt]=useState('');
  const requestId=useRef<string|null>(null), payloadKey=useRef('');
  const submitted=useRef(false); const successRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(receipt)successRef.current?.focus();},[receipt]);
  function chooseLanguage(value:GuestLanguage){setLang(value); const url=new URL(location.href); url.searchParams.set('lang',value); history.replaceState(null,'',url);}
  useEffect(()=>{
    const controller=new AbortController();setTourLoading(true);setTourError(false);
    fetch('/api/public/tours',{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error(); const rows=await r.json();if(!Array.isArray(rows))throw Error();setTours(rows);})
      .catch(()=>{if(!controller.signal.aborted)setTourError(true);}).finally(()=>{if(!controller.signal.aborted)setTourLoading(false);});
    return()=>controller.abort();
  },[attempt]);
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(submitted.current)return;
    const data=new FormData(event.currentTarget);
    const payload={slug:guide.slug,guestName:String(data.get('guestName')),email:String(data.get('email')),phone:String(data.get('phone')),arrivalDate:String(data.get('arrivalDate')),arrivalTime:String(data.get('arrivalTime')),flightNumber:String(data.get('flightNumber')),passengers:Number(data.get('passengers')),luggage:Number(data.get('luggage')),message:String(data.get('message')),language:lang,consent:data.get('consent')==='on',website:String(data.get('website')||'')};
    const key=JSON.stringify(payload);if(payloadKey.current!==key){payloadKey.current=key;requestId.current=crypto.randomUUID();}
    submitted.current=true;setBusy(true);setError(null);
    try{const res=await fetch('/api/public/guest-services',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:requestId.current,...payload})});const result=await res.json();if(!res.ok){setError(res.status);return;}setReceipt(result.id);}
    catch{setError(0);}finally{setBusy(false);submitted.current=false;}
  }
  const mapUrl=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(guide.address)}`;
  return <div lang={lang==='zh'?'zh-Hans':lang} className="min-h-screen bg-[#f7f5ef] text-[#233e34] selection:bg-[#dbe5d8]">
    <header className="mx-auto flex max-w-6xl flex-wrap gap-4 items-center justify-between px-5 py-6 sm:px-8">
      <Link href="/" className={`text-lg tracking-[.12em] ${focus}`}>void anchae<span className="ml-3 hidden text-[10px] uppercase tracking-[.2em] text-stone-500 sm:inline">{t.guideLabel}</span></Link>
      <label className="flex items-center gap-2 text-xs text-stone-600">{t.language}<select aria-label={t.language} value={lang} onChange={e=>chooseLanguage(e.target.value as GuestLanguage)} className={`min-h-11 rounded-full border border-stone-300 bg-transparent px-4 py-2 text-sm text-[#233e34] ${focus}`}>{guestLanguages.map(l=><option key={l} value={l}>{guestLanguageNames[l]}</option>)}</select></label>
    </header>
    <main>
      <section className="mx-auto grid max-w-6xl gap-8 px-5 pb-10 pt-8 sm:px-8 md:grid-cols-[1.1fr_1fr] md:items-center md:gap-14 md:pb-16">
        <div><p className="mb-6 text-[10px] font-semibold tracking-[.22em] text-[#667d60]">{t.tag}</p><h1 style={lang !== 'en' ? {fontSize: 'clamp(2rem, 3.3vw, 2.6rem)', wordBreak: 'keep-all'} : undefined} className="whitespace-pre-line font-serif text-[clamp(2.3rem,5vw,4.25rem)] leading-[1.14] tracking-tight">{t.title}</h1><p className="mt-6 max-w-md text-sm leading-7 text-stone-600 sm:text-base">{t.intro}</p><div className="mt-8 flex flex-wrap gap-3"><a href="#essentials" className={`inline-flex min-h-12 items-center gap-3 rounded-full bg-[#233e34] px-6 text-sm text-white ${focus}`}>{t.stay}<ArrowDown size={15}/></a><a href="#pickup" className={`inline-flex min-h-12 items-center gap-3 rounded-full border border-stone-300 px-6 text-sm ${focus}`}>{t.pickup}<ArrowUpRight size={15}/></a></div><p className="mt-8 flex items-center gap-2 text-xs text-stone-500"><MapPin size={14}/>{propertyName} · {t.region}</p></div>
        <div className="relative h-[340px] overflow-hidden rounded-t-[150px] rounded-b-2xl sm:h-[430px]"><Image src={guide.image} alt={propertyName} fill priority sizes="(max-width: 767px) 100vw, 480px" className="object-cover"/><div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-7 pt-20 text-white"><p className="text-xs uppercase tracking-[.2em]">{t.home}</p><p className="mt-2 font-serif text-3xl">{propertyName}</p></div></div>
      </section>
      <nav aria-label={t.sectionLabel} className="border-y border-[#dedfd5] bg-[#eeeee5]"><div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-5 py-2 sm:px-8">{[['essentials',t.stay],['pickup',t.pickup],['experiences',t.tours]].map(([id,label],i)=><a key={id} href={`#${id}`} className={`flex min-h-12 items-center gap-3 text-xs sm:text-sm ${focus}`}><span className="text-[#89927c]">0{i+1}</span>{label}<ArrowDown size={13}/></a>)}</div></nav>
      <section id="essentials" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-14 sm:px-8 sm:py-20"><p className="text-[10px] tracking-[.2em] text-stone-500">01 / {t.guide}</p><h2 className="mt-3 font-serif text-3xl sm:text-4xl">{t.essentials}</h2><div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-[#dedfd5] bg-white/60 p-6"><Clock3 size={20} strokeWidth={1.4}/><div className="mt-5 grid grid-cols-2 gap-6"><div><p className="text-xs text-stone-500">{t.checkin}</p><p className="mt-2 font-serif text-4xl">{guide.checkIn}</p></div><div><p className="text-xs text-stone-500">{t.checkout}</p><p className="mt-2 font-serif text-4xl">{guide.checkOut}</p></div></div></div>
        <div className="rounded-2xl border border-[#dedfd5] bg-white/60 p-6"><MapPin size={20} strokeWidth={1.4}/><h3 className="mt-4 font-medium">{t.address}</h3><p className="mt-2 text-sm leading-6 text-stone-600">{lang==='ko'?guide.address:guide.addressEn}</p><a href={mapUrl} target="_blank" rel="noreferrer" className={`mt-2 inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4 ${focus}`}>{t.map}<ArrowUpRight size={14}/></a></div>
        <div className="rounded-2xl border border-[#dedfd5] p-6"><Luggage size={20} strokeWidth={1.4}/><h3 className="mt-4 font-medium">{t.luggage}</h3><p className="mt-2 text-sm leading-7 text-stone-600">{t.luggageText}</p></div>
        <div className="rounded-2xl border border-[#dedfd5] p-6"><CarFront size={20} strokeWidth={1.4}/><h3 className="mt-4 font-medium">{t.parking}</h3><div className="mt-2 space-y-3 text-sm leading-7 text-stone-600"><p>{t.parkingText}</p><ul className="list-disc space-y-1 pl-5">{t.parkingPlaces.map(place=><li key={place}>{place}</li>)}</ul><p>{t.parkingPrice}</p><p>{t.parkingCheck}</p></div></div>
      </div></section>
      <section id="pickup" className="scroll-mt-5 bg-[#e9eddf] px-5 py-14 sm:px-8 sm:py-20"><div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[.85fr_1.15fr] lg:gap-16"><div><p className="text-[10px] tracking-[.2em] text-[#667d60]">02 / {t.ride}</p><Plane size={30} strokeWidth={1} className="mt-8"/><h2 className="mt-5 whitespace-pre-line font-serif text-4xl leading-tight sm:text-5xl">{t.rideTitle}</h2><p className="mt-5 text-sm leading-7 text-stone-600">{t.rideText}</p><p className="mt-7 text-3xl font-medium tracking-tight">{t.price}</p><p className="mt-2 text-xs leading-6 text-stone-600">{t.priceNote}</p><ol className="mt-8 space-y-4 border-t border-[#cdd5c1] pt-7">{t.steps.map((step,i)=><li key={step} className="flex items-center gap-3 text-sm"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#b5c1a6] text-xs">{i+1}</span>{step}</li>)}</ol><p className="mt-7 text-xs leading-6 text-stone-600">{t.checkNote}</p></div>
        <div className="rounded-3xl border border-white/80 bg-[#fbfcf8] p-5 sm:p-8">{receipt?<div ref={successRef} tabIndex={-1} role="status" className="py-12 outline-none"><Check size={34} className="mb-6"/><h3 className="font-serif text-3xl">{t.received}</h3><p className="mt-5 text-sm leading-7 text-stone-600">{t.receivedText}</p><p className="mt-7 text-xs text-stone-500">{t.reference}</p><code className="mt-2 block break-all text-sm">{receipt}</code></div>:<form onSubmit={submit}><h3 className="font-serif text-2xl">{t.formTitle}</h3><p className="mt-3 text-xs leading-6 text-stone-500">{t.formSubtitle}</p><fieldset disabled={busy} className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">{t.name}<input name="guestName" required maxLength={100} autoComplete="name" className={field}/></label>
          <label className="text-sm">{t.email}<input name="email" type="email" required maxLength={200} autoComplete="email" className={field}/></label>
          <label className="text-sm">{t.phone}<input name="phone" type="tel" required minLength={7} maxLength={30} autoComplete="tel" placeholder="+82 10 1234 5678" className={field}/></label>
          <label className="text-sm">{t.date}<input name="arrivalDate" type="date" min={todayKst()} max={addDaysToDateStr(todayKst(),365)} required className={field}/></label>
          <label className="text-sm">{t.time}<input name="arrivalTime" type="time" required className={field}/></label>
          <label className="text-sm sm:col-span-2">{t.flight}<input name="flightNumber" placeholder="KE902" required maxLength={9} pattern="[A-Za-z0-9]{2,3}[ ]?[0-9]{1,4}[A-Za-z]?" className={`${field} uppercase`}/></label>
          <label className="text-sm">{t.passengers}<input name="passengers" type="number" min={1} max={12} step={1} defaultValue={2} required className={field}/></label>
          <label className="text-sm">{t.bags}<input name="luggage" type="number" min={0} max={30} step={1} defaultValue={2} required className={field}/></label>
          <label className="text-sm sm:col-span-2">{t.message}<textarea name="message" rows={3} maxLength={1000} className={field}/></label>
          <div aria-hidden="true" className="hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
          <label className="flex items-start gap-3 text-xs leading-6 text-stone-600 sm:col-span-2"><input name="consent" type="checkbox" required className="mt-1 h-4 w-4 shrink-0 accent-[#31594c]"/>{t.consent}</label>
          {error!==null&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm leading-6 text-red-800 sm:col-span-2">{error===400?t.inputError:error===429?t.rateError:t.retryText}</p>}
          <button disabled={busy} className={`flex min-h-13 items-center justify-center gap-3 rounded-full bg-[#233e34] px-6 py-4 text-sm text-white disabled:opacity-60 sm:col-span-2 ${focus}`}>{busy?<Loader2 size={16} className="animate-spin"/>:<ArrowUpRight size={16}/>} {busy?t.sending:t.submit}</button>
          <p className="text-center text-[11px] leading-5 text-stone-500 sm:col-span-2">{t.saved}</p>
        </fieldset></form>}</div>
      </div></section>
      <section id="experiences" className="mx-auto max-w-6xl scroll-mt-5 px-5 py-14 sm:px-8 sm:py-20"><p className="text-[10px] tracking-[.2em] text-stone-500">03 / {t.discover}</p><div className="mt-3 flex flex-wrap items-end justify-between gap-5"><div><h2 className="font-serif text-3xl sm:text-4xl">{t.discoverTitle}</h2><p className="mt-4 max-w-xl text-sm leading-7 text-stone-600">{t.discoverText}</p>{lang!=='ko'&&<p className="mt-2 text-xs text-stone-500">{t.tourLanguage}</p>}</div><Link href="/tours" className={`inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4 ${focus}`}>{t.allTours}<ArrowUpRight size={15}/></Link></div>
        {tourLoading?<p role="status" className="py-12 text-stone-500"><Loader2 size={22} className="animate-spin"/><span className="sr-only">{t.loading}</span></p>:tourError?<div role="alert" className="mt-7 rounded-xl border border-stone-300 p-6 text-sm">{t.tourError}<button onClick={()=>setAttempt(a=>a+1)} className={`ml-4 min-h-11 underline ${focus}`}>{t.retry}</button></div>:!tours.length?<p className="mt-7 rounded-xl border border-dashed border-stone-300 p-8 text-sm text-stone-600">{t.noTours}</p>:<div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{tours.slice(0,3).map(tour=><Link key={tour.id} href={`/tours/${encodeURIComponent(tour.slug)}`} className={`group overflow-hidden rounded-2xl border border-[#dedfd5] bg-white ${focus}`}><div className="relative aspect-[4/3] bg-[#e9eddf]">{tour.images[0]?<Image src={tour.images[0]} alt="" fill unoptimized sizes="(max-width: 639px) 100vw, 360px" className="object-cover transition-transform duration-500 group-hover:scale-105"/>:<div className="grid h-full place-items-center font-serif text-3xl text-[#829375]">{t.slowSeoul}</div>}</div><div className="p-6">{tour.durationMin&&<p className="text-xs text-stone-500">{tour.durationMin} {t.minute}</p>}<h3 className="mt-2 text-lg font-medium">{guestTourCopy(tour,lang).title}</h3><p className="mt-3 line-clamp-2 text-sm leading-6 text-stone-600">{guestTourCopy(tour,lang).description}</p><p className="mt-5 text-sm">{tour.basePrice!=null?t.startingPrice.replace('{price}',tour.basePrice.toLocaleString('en-US')):t.priceOnPage}</p><span className="mt-5 flex items-center justify-between border-t border-stone-100 pt-4 text-xs">{t.tourButton}<ArrowUpRight size={16}/></span></div></Link>)}</div>}
      </section>
      <section className="border-t border-[#dedfd5] px-5 py-10 text-center sm:px-8"><h2 className="font-serif text-2xl">{t.help}</h2><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-stone-600">{t.helpText}</p></section>
    </main><footer className="border-t border-[#dedfd5] px-5 py-8 text-center"><p className="text-sm tracking-[.15em]">void anchae</p><p className="mt-3 text-xs text-stone-500">{t.footer}</p></footer>
  </div>;
}




