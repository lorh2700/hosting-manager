'use client';
import { useRef, useState } from 'react';
import { toast } from '@/components/ui';
export default function CancelCleaningApplication({id,name,date,onCancelled,disabled}:{id:string;name:string;date:string;onCancelled:()=>Promise<void>;disabled?:boolean}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function cancel(){if(busy||!reason.trim())return;setBusy(true);setError('');try{
  const res=await fetch(`/api/cleaning-applications/${id}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:reason.trim()})});
  const data=await res.json();if(!res.ok)throw Error(data.error||'취소하지 못했습니다.');
  dialog.current?.close();toast.success(data.notificationFailed?'취소되었습니다. 알림 전송에 실패했으니 관리자에게도 알려주세요.':'신청을 취소했습니다.');await onCancelled();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <><button type="button" disabled={disabled} className="mt-3 min-h-11 rounded-xl border border-red-200 px-4 text-sm text-red-700 disabled:opacity-40" onClick={()=>{setReason('');setError('');dialog.current?.showModal();}}>신청 취소</button>
 <dialog ref={dialog} aria-label="청소 신청 취소 확인" onCancel={e=>{if(busy)e.preventDefault();}} className="m-auto w-[calc(100%-24px)] max-w-md rounded-2xl p-6 backdrop:bg-black/40">
 <h2 className="text-lg font-semibold">청소 신청을 취소하시겠어요?</h2><p className="mt-3">{name} · {date}</p><p className="mt-2 text-sm text-stone-600">취소한 일정은 다른 담당자가 신청할 수 있게 되며 호스트에게 알림을 보냅니다.</p>
 <label className="mt-4 block text-sm">취소 사유<textarea autoFocus value={reason} disabled={busy} maxLength={500} onChange={e=>setReason(e.target.value)} className="mt-2 block w-full rounded-lg border p-3" rows={3}/></label>
 {error&&<p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
 <div className="mt-4 flex gap-2"><button type="button" disabled={busy} className="min-h-11 flex-1 rounded-xl border" onClick={()=>dialog.current?.close()}>돌아가기</button><button type="button" disabled={busy||!reason.trim()} className="min-h-11 flex-1 rounded-xl bg-red-700 text-white disabled:opacity-40" onClick={()=>void cancel()}>{busy?'취소 중…':'취소 확정'}</button></div>
 </dialog></>;
}
