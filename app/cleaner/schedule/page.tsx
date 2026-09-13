'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { todayKst, addDaysToDateStr } from '@/lib/dates';
import { useRefetchOnReturn } from '@/lib/hooks/useRefetchOnReturn';
import { format, parseISO, addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { toast, SkeletonList } from '@/components/ui';

type Cleaning = {id:string;propertyId:string;propertyName:string;date:string;supplies?:string;notes?:string;cleanerId?:string;status:string;isOpen:boolean};
type Application = {id:string;applicantId:string;cleaningId:string;propertyId:string;propertyName?:string;cleaningDate?:string;status:string;rejectedReason?:string};
const button='min-h-11 rounded-xl border border-stone-300 px-4 py-2 text-sm disabled:opacity-40';
const dateLabel=(date:string)=>format(parseISO(date),'M월 d일 (EEE)',{locale:ko});
const statusLabel:Record<string,string>={pending:'신청 대기',approved:'배정 완료',rejected:'신청 반려'};

export default function CleanerSchedulePage(){
 const {user,profile}=useAuth();
 const [cleanings,setCleanings]=useState<Cleaning[]>([]),[apps,setApps]=useState<Application[]>([]),[properties,setProperties]=useState<{id:string;name:string}[]>([]);
 const [loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(''),[applying,setApplying]=useState(false),[selected,setSelected]=useState<Cleaning|null>(null);
 const [tab,setTab]=useState('available'),[property,setProperty]=useState(''),[date,setDate]=useState(''),[calendar,setCalendar]=useState(true),[month,setMonth]=useState(()=>startOfMonth(parseISO(todayKst())));
 const [holidays,setHolidays]=useState<Record<string,string>>({}),[holidayError,setHolidayError]=useState(''),[holidayLoading,setHolidayLoading]=useState(true),[assigned,setAssigned]=useState<Cleaning[]>([]);
 async function loadHolidays(){setHolidayLoading(true);try{const data=await read('/api/holidays');setHolidays(data.holidays);setHolidayError('');}catch{setHolidayError('공휴일 정보를 불러오지 못했습니다.');}finally{setHolidayLoading(false);}}
 useEffect(()=>{if(user)void loadHolidays();},[user]);
 const today=todayKst(),cutoff=addDaysToDateStr(today,28);
 async function read(url:string){const res=await fetch(url,{cache:'no-store'});if(!res.ok)throw Error('일정을 불러오지 못했습니다. 다시 시도해주세요.');return res.json();}
 async function load(){if(!user)return;setRefreshing(true);try{
   const [props,applications,me]=await Promise.all([read('/api/properties'),read('/api/cleaning-applications'),read('/api/cleaners/me')]);
   const rows=props.length?await read(`/api/cleanings?propertyIds=${props.map((p:{id:string})=>p.id).join(',')}`):[];
   const names:Record<string,string>=Object.fromEntries(props.map((p:{id:string;name:string})=>[p.id,p.name]));
   setAssigned(rows.filter((c:Cleaning)=>me.cleaner?.id&&c.cleanerId===me.cleaner.id).map((c:Cleaning)=>({...c,propertyName:names[c.propertyId]||'숙소'})));
   setProperties(props);setApps(applications.filter((a:Application)=>a.applicantId===user.id));
   setCleanings(rows.filter((c:Cleaning)=>!c.cleanerId&&c.isOpen&&c.status!=='done'&&c.date>=today&&c.date<=cutoff).map((c:Cleaning)=>({...c,propertyName:names[c.propertyId]||'숙소'})).sort((a:Cleaning,b:Cleaning)=>a.date.localeCompare(b.date)||a.propertyName.localeCompare(b.propertyName)));
   setError('');
 }catch(e){setError((e as Error).message);}finally{setLoading(false);setRefreshing(false);}}
 useEffect(()=>{if(user&&profile)void load();},[user,profile]);
 useRefetchOnReturn(load,{enabled:!selected&&!applying});
 async function apply(){if(!selected||applying)return;setApplying(true);try{
   const res=await fetch('/api/cleaning-applications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cleaningId:selected.id,applicantName:profile?.displayName})});
   const data=await res.json();if(!res.ok)throw Error(data.error||'신청하지 못했습니다.');
   setCleanings(rows=>rows.filter(c=>c.id!==selected.id));setSelected(null);toast.success('배정이 완료되었습니다. 내 신청 내역에서 확인하세요.');await load();
 }catch(e){toast.error((e as Error).message);await load();}finally{setApplying(false);}}
 const activeIds=new Set(apps.filter(a=>a.status!=='rejected').map(a=>a.cleaningId));
 const available=cleanings.filter(c=>!activeIds.has(c.id));
 const filtered=available.filter(c=>!property||c.propertyId===property);
 const shown=filtered.filter(c=>!date||c.date===date);
 const myShown=apps.filter(a=>(!property||a.propertyId===property)&&(!date||a.cleaningDate===date));
 const days:Date[]=[];for(let d=startOfWeek(startOfMonth(month),{weekStartsOn:1});d<=endOfWeek(endOfMonth(month),{weekStartsOn:1});d=addDays(d,1))days.push(d);
 if(loading)return <SkeletonList count={3} rows={2}/>;
 return <div className="space-y-5 pb-6">
 <header className="mt-4"><h1 className="text-2xl font-semibold">청소 신청</h1><p className="mt-2 text-sm text-stone-600">{dateLabel(today)}부터 {dateLabel(cutoff)}까지 신청할 수 있습니다.</p><p className="mt-1 text-sm text-amber-800">신청을 완료하면 선착순으로 바로 배정됩니다.</p></header>
 {error&&<div role="alert" className="rounded-xl bg-amber-50 p-4 text-sm">{error} 표시된 일정은 최신 정보가 아닐 수 있습니다.<button className={button+' mt-2'} disabled={refreshing} onClick={()=>void load()}>다시 불러오기</button></div>}
 <div className="grid grid-cols-2 gap-2" aria-label="일정 보기">{[['available',`신청 가능 ${available.length}`],['mine',`내 신청 ${apps.length}`]].map(([key,label])=><button key={key} aria-pressed={tab===key} className={button+(tab===key?' bg-stone-900 text-white':' bg-white')} onClick={()=>{setTab(key);setDate('');}}>{label}</button>)}</div>
 <div className="flex gap-2 flex-wrap"><label className="flex-1 min-w-40 text-xs text-stone-500">숙소<select value={property} onChange={e=>{setProperty(e.target.value);setDate('');}} className="block w-full min-h-11 rounded-xl border bg-white px-3 text-sm text-stone-900 mt-1"><option value="">전체 담당 숙소</option>{properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className={button+' self-end'} aria-expanded={calendar} onClick={()=>setCalendar(v=>!v)}>{calendar?'목록 보기':'달력 보기'}</button><button className={button+' self-end'} disabled={refreshing||applying} onClick={()=>void load()}>{refreshing?'갱신 중…':'새로고침'}</button></div>
 {calendar&&<section className="rounded-2xl border bg-white p-3">
 <div className="flex justify-between items-center mb-3"><button aria-label="이전 달" className={button} disabled={month<=startOfMonth(parseISO(today))} onClick={()=>setMonth(addMonths(month,-1))}>‹</button><h2 className="font-semibold">{format(month,'yyyy년 M월')}</h2><button aria-label="다음 달" className={button} disabled={month>=startOfMonth(parseISO(cutoff))} onClick={()=>setMonth(addMonths(month,1))}>›</button></div>
 <div className="grid grid-cols-7 gap-px bg-stone-200 border border-stone-200 rounded-xl overflow-hidden">{['월','화','수','목','금','토','일'].map((d,i)=><span key={d} className={`bg-white text-center text-xs py-2 ${i===6?'text-red-700':i===5?'text-blue-700':'text-stone-500'}`}>{d}</span>)}
 {days.map(d=>{const key=format(d,'yyyy-MM-dd');const count=filtered.filter(c=>c.date===key).length;const mine=assigned.filter(c=>c.date===key&&(!property||c.propertyId===property)).length;const holiday=holidays[key];const inRange=key>=today&&key<=cutoff;return <button key={key} aria-label={`${dateLabel(key)}${holiday?', '+holiday:''}, 신청 가능 ${count}건, 내 배정 ${mine}건`} aria-pressed={date===key} className={`min-h-24 min-w-0 p-1 sm:p-2 text-left flex flex-col border-2 ${date===key?'bg-amber-50 border-amber-700':'bg-white border-transparent'} ${format(d,'MM')!==format(month,'MM')?'opacity-50':''}`} onClick={()=>setDate(key)}>
 <span className={`text-sm font-medium ${holiday||d.getDay()===0?'text-red-700':d.getDay()===6?'text-blue-700':'text-stone-800'} ${key===today?'underline underline-offset-4':''}`}>{format(d,'d')}</span>
 {holiday&&<span className="text-[10px] leading-tight text-red-700 break-words mt-1">{holiday}</span>}
 <span className="mt-auto w-full pt-1 space-y-1">{count>0&&<span className="block rounded bg-stone-100 text-stone-700 text-[10px] text-center">가능 {count}</span>}{mine>0&&<span className="block rounded bg-emerald-50 text-emerald-800 text-[10px] text-center">배정 {mine}</span>}{!inRange&&!holiday&&<span className="text-[10px] text-stone-400">기간 외</span>}</span>
 </button>;})}</div><p className="text-xs text-stone-500 mt-3">날짜를 눌러 숙소 확인 · 가능: 신청 가능한 청소 / 배정: 내 청소 일정</p>
 {holidayLoading?<p className="text-xs text-stone-500 mt-2">공휴일 확인 중…</p>:holidayError?<p role="status" className="text-xs text-amber-800 mt-2">{holidayError}<button className="underline min-h-11 ml-2" onClick={()=>void loadHolidays()}>다시 확인</button></p>:<p className="text-xs text-stone-500 mt-2">공휴일: Google 대한민국의 휴일 · 임시공휴일은 원본 달력 갱신 후 반영됩니다.</p>}
 </section>}
 {calendar&&!date&&<p className="text-sm text-stone-600">날짜를 선택하면 아래에 신청 가능한 숙소와 내 배정 일정이 나옵니다.</p>}
 {date&&holidays[date]&&<p className="text-sm font-medium text-red-700">{holidays[date]}</p>}
 {date&&assigned.some(c=>c.date===date&&(!property||c.propertyId===property))&&<section className="rounded-xl bg-emerald-50 p-4"><h2 className="text-sm font-semibold text-emerald-800">이날 내 배정 일정</h2>{assigned.filter(c=>c.date===date&&(!property||c.propertyId===property)).map(c=><p key={c.id} className="text-sm mt-2">{c.propertyName} · {c.status==='done'?'청소 완료':'청소 예정'}</p>)}</section>}

 {date&&<div className="flex justify-between items-center rounded-xl bg-stone-100 px-4"><span className="text-sm">{dateLabel(date)}</span><button className="min-h-11 text-sm underline" onClick={()=>setDate('')}>전체 날짜</button></div>}
 {(!calendar||date)&&(tab==='available'?<section className="space-y-3" aria-label="신청 가능한 청소">
 {!shown.length&&<p className="rounded-2xl border bg-white p-8 text-center text-sm text-stone-500">{error?'일정을 확인하려면 다시 불러오기를 눌러주세요.':'선택한 조건에 신청 가능한 청소가 없습니다.'}</p>}
 {shown.map((c,index)=><div key={c.id}>{(index===0||shown[index-1].date!==c.date)&&<h2 className="font-semibold text-sm pt-3 pb-2">{dateLabel(c.date)}{c.date===today?' · 오늘':''}</h2>}<article className="rounded-2xl border bg-white p-4"><h3 className="font-semibold">{c.propertyName}</h3>{c.supplies&&<p className="text-sm text-stone-600 mt-2 whitespace-pre-wrap">비품 · {c.supplies}</p>}{c.notes&&<p className="text-sm text-stone-600 mt-2 whitespace-pre-wrap">전달사항 · {c.notes}</p>}<button disabled={applying||!!error||refreshing} onClick={()=>setSelected(c)} className={button+' mt-4 w-full bg-stone-900 text-white'}>이 일정 신청하기</button></article></div>)}
 </section>:<section className="space-y-3" aria-label="내 신청 내역">{!myShown.length&&<p className="rounded-2xl border bg-white p-8 text-center text-sm text-stone-500">선택한 조건에 신청 내역이 없습니다.</p>}{myShown.map(a=><article key={a.id} className="rounded-2xl border bg-white p-4"><div className="flex justify-between gap-3"><h2 className="font-semibold">{a.propertyName||properties.find(p=>p.id===a.propertyId)?.name||'숙소 정보 없음'}</h2><span className={`text-xs ${a.status==='approved'?'text-emerald-700':a.status==='rejected'?'text-red-700':'text-amber-800'}`}>{statusLabel[a.status]||a.status}</span></div><p className="text-sm text-stone-600 mt-2">{a.cleaningDate?dateLabel(a.cleaningDate):'일정 정보 없음'}</p>{a.rejectedReason&&<p className="text-sm text-red-700 mt-2">사유 · {a.rejectedReason}</p>}</article>)}</section>)}
 {selected&&<div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-3"><section role="dialog" aria-modal="true" aria-label="청소 신청 확인" className="rounded-2xl bg-white p-6 w-full max-w-md"><h2 className="text-xl font-semibold">이 청소를 맡으시겠어요?</h2><p className="mt-4 font-medium">{selected.propertyName}</p><p className="text-sm mt-1">{dateLabel(selected.date)}</p><p className="mt-4 text-sm text-stone-600">확인하면 바로 담당자로 배정되고 호스트에게 알림이 전달됩니다.</p><div className="grid grid-cols-2 gap-2 mt-5"><button autoFocus disabled={applying} className={button} onClick={()=>setSelected(null)}>돌아가기</button><button disabled={applying||!!error} className={button+' bg-stone-900 text-white'} onClick={()=>void apply()}>{applying?'배정 중…':'확인하고 신청'}</button></div></section></div>}
 </div>;
}
