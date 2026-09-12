'use client';

import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';

type Status = { propertyName: string; date: string; confirmed: boolean; eligible: boolean; message: string | null };
export default function GuestCheckoutPage() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [departed, setDeparted] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const credential = window.location.hash.slice(1);
    setToken(credential);
    if (!credential) { setError('숙소의 QR코드를 다시 스캔해주세요. / Please scan the QR code again.'); return; }
    const controller = new AbortController();
    setError('');
    fetch('/api/public/guest-checkout', { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', token: credential }) })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) setStatus(data);
      }).catch(e => { if (!controller.signal.aborted) setError(e.message || '다시 시도해주세요. / Please try again.'); });
    return () => controller.abort();
  }, [retry]);
  async function confirm() {
    if (!departed || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/public/guest-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', token, viewedDate: status?.date, confirmedDeparture: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setStatus(previous => previous ? { ...previous, confirmed: true } : previous);
    } catch (e) { setError(e instanceof Error ? e.message : '다시 시도해주세요. / Please try again.'); }
    finally { setBusy(false); }
  }
  return <main className="min-h-svh bg-[#eee8dc] text-stone-900 px-6 py-12">
    <div className="max-w-md mx-auto space-y-8">
      <Logo variant="black" width={150} priority />
      <div><p className="text-sm text-stone-600 mb-3">{status?.propertyName ?? '게스트 체크아웃'}</p>
        <h1 className="text-3xl font-light">{status?.confirmed ? '체크아웃이 확인되었습니다' : '편안한 여행 되셨나요?'}</h1>
        <p className="mt-3 text-stone-600">{status?.confirmed ? 'Thank you for staying with us.' : 'Ready to check out?'}</p></div>
      {error && <div role="alert" className="border border-amber-700 rounded-xl p-4 space-y-3"><p>{error}</p>
        <button onClick={() => setRetry(value => value + 1)} className="min-h-11 underline">다시 확인 / Retry</button></div>}
      {!status && !error && <p role="status">예약을 확인하고 있습니다… / Checking your stay…</p>}
      {status && <>
        <p className="text-sm text-stone-600">{status.date} · 한국 시간 / Korea time</p>
        {status.confirmed ? <div role="status" className="rounded-2xl bg-white/60 p-6 leading-relaxed">퇴실 확인이 기록되었습니다. 이용해 주셔서 감사합니다.<br /><span className="text-stone-600">Your checkout has been recorded. Have a safe journey!</span></div>
          : !status.eligible ? <p role="status" className="rounded-xl bg-white/60 p-5">{status.message}</p>
          : <div className="space-y-5">
            <p className="leading-7">짐과 소지품을 모두 챙기고 숙소에서 나오신 후 아래 버튼을 눌러주세요.<br /><span className="text-stone-600">Please take all belongings and leave the accommodation before confirming.</span></p>
            <label className="flex items-start gap-3 rounded-xl bg-white/60 p-4 cursor-pointer"><input type="checkbox" checked={departed} onChange={e => setDeparted(e.target.checked)} className="mt-1 size-5 shrink-0" />
              <span>숙소에서 퇴실했습니다.<br />I have left the accommodation.</span></label>
            <button disabled={!departed || busy} onClick={confirm} className="w-full min-h-14 rounded-xl bg-stone-900 text-white px-4 py-4 disabled:opacity-40">{busy ? '확인 중… / Confirming…' : '체크아웃 완료 / Confirm checkout'}</button>
          </div>}
      </>}
    </div>
  </main>;
}
