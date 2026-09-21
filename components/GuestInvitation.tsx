'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GuestLanguage } from '@/lib/guest-languages';
import styles from './GuestInvitation.module.css';
import { Logo } from '@/components/Logo';
const copy = {
 ko: {welcome:'당신의 쉼을 초대합니다',note:'한옥에 머무는 시간이\n오래 기억될 편안한 쉼이 되기를.',hint:'아래로 스크롤해 초대장을 열어보세요',open:'초대장 바로 열기',guide:'숙소 안내 보기'},
 en: {welcome:'An invitation to slow down',note:'May your time in our hanok\nbe a quiet, lasting memory.',hint:'Scroll to open your invitation',open:'Open invitation',guide:'View your stay guide'},
 ja: {welcome:'心安らぐひとときへ',note:'韓屋で過ごす時間が\n心に残る穏やかな休息になりますように。',hint:'スクロールして招待状を開く',open:'招待状を開く',guide:'宿泊案内を見る'},
 zh: {welcome:'邀您共度静谧时光',note:'愿您在韩屋度过的时光\n成为一段温暖而长久的回忆。',hint:'向下滚动，开启邀请函',open:'直接打开邀请函',guide:'查看入住指南'},
};
export default function GuestInvitation({name,slug,language,preview=false,guestName,stay,invitationKey}:{name:string;slug:string;language:GuestLanguage;preview?:boolean;guestName?:string;stay?:string;invitationKey?:string}) {
 const ref=useRef<HTMLElement>(null);const [progress,setProgress]=useState(0);const [skip,setSkip]=useState(false);const t=copy[language];
 useEffect(()=>{
  const key=`guest-invitation-v1:${invitationKey||slug}`;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen=false;try{seen=sessionStorage.getItem(key)==='opened';}catch{}
  if(!preview&&(seen||reduced)){const id=requestAnimationFrame(()=>setSkip(true));return()=>cancelAnimationFrame(id);}
  let frame=0;
  const update=()=>{frame=0;const el=ref.current;if(!el)return;const rect=el.getBoundingClientRect();const distance=Math.max(1,el.offsetHeight-window.innerHeight);const p=Math.min(1,Math.max(0,-rect.top/distance));setProgress(p);if(p>=.98&&!preview){try{sessionStorage.setItem(key,'opened');}catch{}}};
  const onScroll=()=>{if(!frame)frame=requestAnimationFrame(update);};
  window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll);onScroll();
  return()=>{window.removeEventListener('scroll',onScroll);window.removeEventListener('resize',onScroll);cancelAnimationFrame(frame);};
 },[slug,preview,invitationKey]);
 function advance(guide=false){const el=ref.current;if(!el)return;const top=window.scrollY+el.getBoundingClientRect().top;window.scrollTo({top:top+el.offsetHeight-(guide?0:window.innerHeight),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
 if(skip)return null;
 const flap=Math.min(1,progress/.35);const paper=Math.max(0,Math.min(1,(progress-.25)/.65));
 return <section ref={ref} className={styles.scene} aria-label={t.welcome} style={{'--flap':`${-flap*180}deg`,'--lift':`${-paper*68}%`,'--tilt':`${(1-paper)*-2}deg`,'--fade':1-paper*.8} as CSSProperties}>
  <div className={styles.sticky}>
   <div className={styles.brand}><Logo width={180} variant="black" priority /><span>INVITATION</span></div>
   <div className={styles.stage}>
    <div className={styles.envelope}>
     <div className={styles.back}/>
     <div className={styles.paper}><span className={styles.eyebrow}>A LETTER FOR YOU</span><h1>{name}</h1><p className={styles.welcome}>{guestName ? (language==='ko'?`${guestName}님, 초대합니다`:language==='ja'?`${guestName}様、ようこそ`:language==='zh'?`欢迎您，${guestName}`:`Welcome, ${guestName}`) : t.welcome}</p>{stay&&<p className={styles.stay}>{stay}</p>}<p className={styles.note}>{t.note}</p><span className={styles.signature}><Logo width={128} variant="black" /></span></div>
     <div className={styles.front}/><div className={styles.flap} style={{zIndex:flap>.5?1:5}}/>
     <div className={styles.seal} style={{opacity:Math.max(0,1-progress*5)}}><Logo width={86} variant="white" /></div>
    </div>
   </div>
   <div className={styles.controls}><p>{progress<.95?t.hint:t.welcome}</p><button type="button" onClick={()=>advance(progress>=.95)}>{progress<.95?t.open:t.guide}<span aria-hidden="true"> ↓</span></button></div>
  </div>
 </section>;
}

