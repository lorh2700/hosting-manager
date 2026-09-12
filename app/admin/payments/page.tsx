'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type Row = { id: string; propertyName: string; name: string; checkIn: string; checkOut: string; status: string;
  currency: string; amountMinor: number; mode: string; lastError: string | null; beds24Id: string | null };
const labels: Record<string, string> = { quoted: '요금 조회', holding: '객실 확보 확인 중', awaiting_payment: '결제 대기', approving: '결제 승인 확인 중', fulfilling: '결제 완료 · 예약 반영 중', confirmed: '결제·예약 완료', expired: '기한 만료', refund_pending: '환불·취소 처리 중', refunded: '환불·취소 완료', review: '수동 확인 필요' };
export default function PaymentsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [refund, setRefund] = useState<Row | null>(null);
  const load = useCallback(async () => {
    const res = await fetch('/api/admin/payments', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? '결제 목록을 불러오지 못했습니다.');
    setRows(data);
  }, []);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
  async function act(row: Row, action: string) {
    setBusy(row.id); setError(''); setRefund(null);
    try {
      const res = await fetch('/api/admin/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: row.id, action, confirmFullRefund: action === 'refund' }) });
      if (!res.ok) throw new Error((await res.json()).error ?? '처리 결과를 다시 확인해주세요.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : '처리 오류'); }
    finally { setBusy(''); }
  }
  const amount = (r: Row) => `${r.currency} ${(r.currency === 'USD' ? r.amountMinor / 100 : r.amountMinor).toLocaleString('en-US', { minimumFractionDigits: r.currency === 'USD' ? 2 : 0 })}`;
  return <div className="max-w-4xl mx-auto space-y-5">
    <Link href="/admin/bookings" className="underline">예약 관리</Link>
    <h1 className="text-2xl font-semibold">온라인 결제 관리</h1>
    <p className="text-sm text-stone-600">최근 주문 100건 · 결제와 예약 상태를 함께 확인합니다. 부분 환불은 현재 지원하지 않습니다.</p>
    <button className="min-h-12 underline" onClick={() => { void load().catch(e => setError(e.message)); }}>새로고침</button>
    {error && <p role="alert" className="p-4 bg-rose-50 text-rose-700">{error}</p>}
    {!rows.length && <p>표시할 결제가 없습니다.</p>}
    {rows.map(row => <article key={row.id} className="border border-stone-200 bg-white p-5 space-y-2">
      <h2 className="font-semibold">{row.propertyName} · {row.name} {row.mode === 'test' ? '(테스트)' : ''}</h2>
      <p>{row.checkIn} → {row.checkOut}</p><p>{amount(row)} · {labels[row.status] ?? row.status}</p>
      <p className="text-xs break-all text-stone-500">주문 {row.id} · Beds24 {row.beds24Id ?? '미확보'}</p>
      {row.lastError && <p className="text-amber-800 text-sm">확인 필요: {row.lastError}</p>}
      <div className="flex gap-5">
        <button disabled={!!busy} className="min-h-12 underline disabled:opacity-40" onClick={() => act(row, 'reconcile')}>상태 재확인</button>
        {['confirmed', 'fulfilling', 'refund_pending'].includes(row.status) && <button disabled={!!busy} className="min-h-12 text-rose-700 underline disabled:opacity-40" onClick={() => setRefund(row)}>전액 환불·예약 취소</button>}
      </div>
      {refund?.id === row.id && <div className="border border-rose-200 p-4 space-y-3">
        <p>{amount(row)} 전액을 환불하고 예약을 취소합니다. 고객에게 적용할 취소 규정을 확인했나요? 처리 후 되돌릴 수 없습니다.</p>
        <button className="min-h-12 px-4 bg-rose-700 text-white" onClick={() => act(row, 'refund')}>전액 환불 실행</button>
        <button className="min-h-12 px-4" onClick={() => setRefund(null)}>닫기</button>
      </div>}
    </article>)}
  </div>;
}
