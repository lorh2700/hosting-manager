'use client';

import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';

import { autoConfirmGuestCheckout, type GuestCheckoutStatus } from '@/lib/guest-checkout-client';
export default function GuestCheckoutPage() {
  const [status, setStatus] = useState<GuestCheckoutStatus | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const credential = window.location.hash.slice(1);
    if (!credential) { setError('숙소의 QR코드를 다시 스캔해주세요. / Please scan the QR code again.'); return; }
    const controller = new AbortController();
    setError('');
    setStatus(null);
    void autoConfirmGuestCheckout(credential, controller.signal)
      .then(data => { if (!controller.signal.aborted) setStatus(data); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message || '다시 시도해주세요. / Please try again.'); });
    return () => controller.abort();
  }, [retry]);
  return <main className="min-h-svh bg-[#eee8dc] text-stone-900 px-6 py-12">
    <div className="max-w-md mx-auto space-y-8">
      <Logo variant="black" width={150} priority />
      <div><p className="text-sm text-stone-600 mb-3">{status?.propertyName ?? '게스트 체크아웃'}</p>
        <h1 className="text-3xl font-light">{status?.confirmed ? '체크아웃이 확인되었습니다' : error ? '체크아웃을 확인하지 못했습니다' : status && !status.eligible ? '예약 확인이 필요합니다' : '체크아웃을 확인하고 있습니다'}</h1>
        <p className="mt-3 text-stone-600">{status?.confirmed ? 'Thank you for staying with us.' : error ? 'Please try again.' : status && !status.eligible ? 'Please contact your host.' : 'Confirming your checkout…'}</p></div>
      {error && <div role="alert" className="border border-amber-700 rounded-xl p-4 space-y-3"><p>{error}</p>
        <button onClick={() => setRetry(value => value + 1)} className="min-h-11 underline">다시 확인 / Retry</button></div>}
      {!status && !error && <p role="status">자동으로 퇴실 확인 중입니다. 잠시만 기다려주세요… / Automatically confirming your checkout…</p>}
      {status && <>
        <p className="text-sm text-stone-600">{status.date} · 한국 시간 / Korea time</p>
        {status.confirmed ? <div role="status" className="rounded-2xl bg-white/60 p-6 leading-relaxed">퇴실 확인이 기록되었습니다. 이용해 주셔서 감사합니다.<br /><span className="text-stone-600">Your checkout has been recorded. Have a safe journey!</span></div>
          : !status.eligible ? <p role="status" className="rounded-xl bg-white/60 p-5">{status.message}</p>
          : null}
      </>}
    </div>
  </main>;
}
