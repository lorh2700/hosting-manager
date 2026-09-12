'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Script from 'next/script';
import Link from 'next/link';

type Order = { id: string; status: string; propertyName: string; checkIn: string; checkOut: string; guests: number;
  currency: string; amount: number; gateway: string; terms: string; expiresAt: string; mode: string;
  priceKrw: number; fxRate: string | null; bookingId: string | null; clientKey?: string; customerName?: string; customerEmail?: string };
type TossWindow = Window & { TossPayments?: (key: string) => { payment: (args: { customerKey: string }) => { requestPayment: (args: Record<string, unknown>) => Promise<void> } } };
const statusText: Record<string, string> = {
  quoted: '결제 금액 확인 / Review your payment', holding: '객실 확보 확인 중 / Checking room hold',
  awaiting_payment: '결제 대기 / Awaiting payment', fulfilling: '결제 완료 · 예약 확인 중 / Paid · confirming reservation',
  approving: '결제 승인 확인 중 / Verifying payment approval',
  confirmed: '예약 확정 / Booking confirmed', expired: '결제 기한 만료 / Payment expired',
  refund_pending: '환불 처리 중 / Refund processing', refunded: '결제 취소 완료 / Payment refunded',
  review: '담당자 확인 중 / Under review',
};

export default function CheckoutPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const token = useRef('');
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [international, setInternational] = useState(false);
  const [country, setCountry] = useState('');
  const send = useCallback(async (action: string, extras: object = {}) => {
    const res = await fetch('/api/public/checkout', { method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.current}` },
      body: JSON.stringify({ action, orderId, ...extras }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Payment service unavailable');
    setOrder(data);
    return data as Order;
  }, [orderId]);

  useEffect(() => {
    const fragment = new URLSearchParams(location.hash.slice(1)).get('token');
    if (fragment) {
      sessionStorage.setItem(`checkout:${orderId}`, fragment);
      history.replaceState(null, '', location.pathname + location.search);
    }
    token.current = sessionStorage.getItem(`checkout:${orderId}`) ?? '';
    if (!token.current) { setError('이 브라우저에서 예약을 다시 시작해주세요. / Please reopen checkout in the original browser.'); return; }
    const result = new URLSearchParams(location.search).get('result');
    if (result === 'fail') setError('결제가 완료되지 않았습니다. 다시 시도할 수 있습니다. / Payment was not completed.');
    // Query paymentKey/amount are not trusted: server retrieves the order directly from Toss.
    void send(result === 'success' ? 'confirm' : 'status').catch(e => setError(e.message));
    history.replaceState(null, '', location.pathname);
  }, [orderId, send]);

  useEffect(() => {
    if (!order || !['holding', 'approving', 'fulfilling', 'refund_pending'].includes(order.status)) return;
    const timer = setInterval(() => { void send('status').catch(() => {}); }, 15_000);
    return () => clearInterval(timer);
  }, [order, send]);

  async function pay() {
    setBusy(true); setError('');
    try {
      const started = await send('start', { acceptTerms: agreed });
      const sdk = (window as TossWindow).TossPayments;
      if (!sdk || !started.clientKey) throw new Error('결제창을 불러오지 못했습니다. / Reload the payment page.');
      await sdk(started.clientKey).payment({ customerKey: started.id }).requestPayment({
        method: started.gateway === 'paypal' ? 'FOREIGN_EASY_PAY' : 'CARD',
        amount: { currency: started.currency, value: started.amount },
        orderId: started.id, orderName: `${started.propertyName} ${started.checkIn} ~ ${started.checkOut}`.slice(0, 100),
        customerName: started.customerName, customerEmail: started.customerEmail,
        successUrl: `${location.origin}/book/checkout/${orderId}?result=success`,
        failUrl: `${location.origin}/book/checkout/${orderId}?result=fail`,
        ...(started.gateway === 'paypal' ? { foreignEasyPay: { provider: 'PAYPAL', country } } :
          { card: { useInternationalCardOnly: international, language: international ? 'EN' : 'KO' } }),
      });
    } catch (e) { setError(e instanceof Error ? e.message : '결제 처리 중 오류가 발생했습니다.'); }
    finally { setBusy(false); }
  }
  const payable = order && ['quoted', 'awaiting_payment'].includes(order.status);
  return <main className="min-h-screen bg-stone-950 text-stone-100 px-5 py-12">
    <Script src="https://js.tosspayments.com/v2/standard" onReady={() => setSdkReady(true)} onError={() => setError('결제창 로딩 실패 / Payment SDK failed to load')} />
    <div className="max-w-lg mx-auto space-y-7">
      <Link href="/" className="text-sm tracking-widest">VOID ANCHAE</Link>
      <h1 className="text-2xl">{order ? statusText[order.status] ?? '처리 중 / Processing' : '예약 결제 / Reservation payment'}</h1>
      {order && <>
        {order.mode === 'test' && <p className="p-3 border border-amber-500 text-amber-300">테스트 결제 / TEST — 실제 결제가 아닙니다.</p>}
        <section className="space-y-3 border-y border-stone-700 py-6">
          <h2 className="text-xl">{order.propertyName}</h2>
          <p>{order.checkIn} → {order.checkOut} · {order.guests} guests</p>
          <p className="text-3xl">{order.currency} {order.amount.toLocaleString('en-US', { minimumFractionDigits: order.currency === 'USD' ? 2 : 0 })}</p>
          {order.fxRate && <p className="text-sm text-stone-300">KRW {order.priceKrw.toLocaleString()} · 1 USD = KRW {order.fxRate}<br />위 USD 금액으로 결제합니다. / You will be charged the USD amount above.</p>}
          {order.status === 'confirmed' && <p>예약번호 / Booking reference: {order.bookingId}</p>}
          {payable && <p className="text-sm text-stone-400">결제 전 객실과 요금을 다시 확인합니다. / Availability and price are rechecked before payment.</p>}
        </section>
        <details className="border border-stone-700 p-4" open={!!payable}>
          <summary className="cursor-pointer">취소·환불 규정 / Cancellation & refund policy</summary>
          <p className="whitespace-pre-wrap text-sm leading-7 mt-4">{order.terms}</p>
        </details>
        {payable && <>
          <label className="flex items-start gap-3 py-2"><input className="mt-1 size-5" type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
            <span>일정·금액·취소 규정에 동의합니다.<br />I agree to the dates, total price and cancellation policy.</span></label>
          {order.gateway === 'card' && <label className="flex gap-3"><input type="checkbox" checked={international} onChange={e => setInternational(e.target.checked)} />Overseas-issued card / 해외 발급 카드</label>}
          {order.gateway === 'paypal' && <label className="block space-y-2"><span>PayPal account country / 계정 국가</span>
            <select className="block w-full min-h-12 bg-stone-900 border border-stone-600 p-3" value={country} onChange={e => setCountry(e.target.value)}>
              <option value="">Select your country</option>
              {['US','GB','CA','AU','NZ','JP','TW','HK','SG','MY','TH','PH','ID','VN','IN','DE','FR','IT','ES','NL','BE','CH','AT','SE','NO','DK','FI','IE','PT','PL','CZ','GR','AE','IL','BR','MX','ZA','KR'].map(code => <option key={code} value={code}>{new Intl.DisplayNames(['en'], { type: 'region' }).of(code)}</option>)}
            </select></label>}
          <button onClick={pay} disabled={busy || !agreed || !sdkReady || (order.gateway === 'paypal' && !country)} className="w-full min-h-14 bg-stone-100 text-stone-950 px-4 py-4 disabled:opacity-40">
            {busy ? '처리 중 / Processing…' : `${order.gateway === 'paypal' ? 'PayPal' : '카드·간편결제 / Card'} · ${order.currency} ${order.amount} 결제 / Pay`}
          </button>
        </>}
        {!['confirmed', 'expired', 'refunded', 'quoted'].includes(order.status) && <button disabled={busy} className="min-h-12 underline" onClick={async () => {
          setBusy(true); try { await send('confirm'); } catch (e) { setError(String(e)); } finally { setBusy(false); }
        }}>결제·예약 상태 다시 확인 / Check payment status</button>}
        {['holding', 'approving', 'fulfilling', 'review'].includes(order.status) && <p className="text-sm text-stone-300">처리 결과를 확인 중입니다. 새 예약이나 추가 결제를 하지 말고 이 페이지에서 확인해주세요.<br />Please wait here; do not create another booking or payment. Reference: {order.id}</p>}
      </>}
      {error && <p role="alert" className="p-4 border border-rose-400 text-rose-200">{error}</p>}
      <Link className="inline-block min-h-12 underline" href="/">홈으로 / Home</Link>
    </div>
  </main>;
}
