'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';

type Qr = { propertyName: string; url: string; image: string };
export default function CheckoutQrPage() {
  const { id } = useParams() as { id: string };
  const { user } = useAuth();
  const [qr, setQr] = useState<Qr | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setQr(null); setError(''); setCopied(false);
    fetch(`/api/checkout/qr?propertyId=${encodeURIComponent(id)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) setQr(data);
      }).catch(e => { if (!controller.signal.aborted) setError(e.message || 'QR을 불러오지 못했습니다.'); });
    return () => controller.abort();
  }, [id, user, retry]);
  return <div className="max-w-xl mx-auto space-y-6 pb-nav px-4">
    <Link href={`/admin/properties/${id}`} className="inline-flex min-h-11 items-center text-sm underline">숙소로 돌아가기</Link>
    <div><h1 className="text-2xl font-semibold">게스트 체크아웃 QR</h1><p className="text-sm text-stone-500 mt-2">숙소 안내문에 붙여 계속 사용할 수 있는 고정 QR입니다.</p></div>
    {error && <div role="alert"><p className="text-red-700">{error}</p><button onClick={() => setRetry(value => value + 1)} className="min-h-11 underline">다시 불러오기</button></div>}
    {!qr && !error && <p role="status">QR을 준비하고 있습니다…</p>}
    {qr && <>
      <section className="rounded-2xl border border-stone-200 bg-white p-6 text-center space-y-3">
        <p className="text-xl font-semibold">{qr.propertyName}</p>
        <h2 className="text-lg">체크아웃 / Check out</h2>
        {/* Server-generated PNG; no guest URL is sent to a third-party QR service. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr.image} alt={`${qr.propertyName} 게스트 체크아웃 QR코드`} width={900} height={900} className="w-full max-w-[340px] mx-auto" />
        <p className="text-sm leading-6">퇴실 후 QR을 스캔하고 체크아웃 완료를 눌러주세요.<br />Scan after leaving and confirm your checkout.</p>
      </section>
      <div className="flex flex-wrap gap-3">
        <a href={qr.image} download={`${qr.propertyName}-checkout-qr.png`} className="inline-flex min-h-12 items-center justify-center bg-stone-900 text-white rounded-lg px-5">QR 이미지 저장</a>
        <button onClick={async () => { try { await navigator.clipboard.writeText(qr.url); setCopied(true); } catch { setError('링크를 복사하지 못했습니다. 아래 링크를 직접 복사해주세요.'); } }} className="min-h-12 border rounded-lg px-5">{copied ? '복사됨' : '링크 복사'}</button>
      </div>
      <label className="block text-sm">게스트용 링크<input readOnly value={qr.url} onFocus={e => e.target.select()} className="mt-2 w-full border rounded-lg p-3 text-base" /></label>
      <p className="text-sm text-stone-500 leading-6">오늘 퇴실 예정 예약이 있을 때만 완료할 수 있습니다. 스캔만으로 처리되지 않으며, 중복 완료는 한 번만 기록됩니다. 관리자 오늘 화면에 ‘게스트 셀프 체크아웃’으로 표시됩니다.</p>
    </>}
  </div>;
}
