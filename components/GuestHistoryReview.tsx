'use client';
import { useCallback, useEffect, useState } from 'react';
type Guest = { id: string; name: string | null; email: string | null; phone: string | null };
type Row = Guest & { key: string; propertyId: string; guestId: string | null; checkIn: string; checkOut: string; status: string; matchStatus: string; matchReason: string; candidateIds: string[]; summary: { confirmedReservations: number; completedStays: number; isRebooking: boolean } | null };
type Result = { rows: Row[]; guests: Guest[]; properties: { id: string; name: string }[]; hasMore: boolean };
export function GuestHistoryReview() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const res: Response = await fetch(`/api/guests/history?offset=${offset}`, { cache: 'no-store' });
    if (res.status === 403) { setData(null); return; }
    if (!res.ok) throw new Error('재예약 검토 정보를 불러오지 못했습니다.');
    setData(await res.json());
  }, [offset]);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
  async function review(id: string, action: string, guestId?: string) {
    setBusy(true); setError('');
    try {
      const res: Response = await fetch('/api/guests/history', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, guestId }) });
      if (!res.ok) throw new Error('검토 결과를 저장하지 못했습니다.');
      await load();
    } catch(e) { setError(e instanceof Error ? e.message : '저장 오류'); } finally { setBusy(false); }
  }
  async function reconcile() {
    setBusy(true); setError(''); let count = 0;
    try {
      let stage: string | null = 'guests', cursor: string | null = null;
      while (stage) {
        const res: Response = await fetch('/api/guests/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage, cursor }) });
        if (!res.ok) throw new Error('이력 정리가 중단되었습니다. 다시 실행하면 중복 없이 재처리합니다.');
        const result: { count: number; nextStage: string | null; nextCursor: string | null } = await res.json(); count += result.count; stage = result.nextStage; cursor = result.nextCursor;
        setNotice(`${count}건 처리 중…`);
      }
      setNotice(`${count}건 확인 완료. 아래 목록을 갱신했습니다.`); await load();
    } catch(e) { setError(e instanceof Error ? e.message : '정리 오류'); } finally { setBusy(false); }
  }
  if (!data && !error) return null;
  return <section className="bg-white border border-stone-200 p-5 mb-8 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">재예약 검토</h2><button disabled={busy} onClick={reconcile} className="border px-4 py-2 disabled:opacity-50">기존 예약 이력 정리</button></div>
    <p className="text-sm text-stone-500">확정 예약 이력으로 재예약을 판별합니다. 이름만 같은 고객은 자동 연결하지 않습니다. 과거 날짜만으로 실제 숙박 완료를 확정하지 않습니다.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}{notice && <p role="status">{notice}</p>}
    {data?.rows.length === 0 && <p>저장된 고객 예약 이력이 없습니다. ‘기존 예약 이력 정리’를 실행해주세요.</p>}
    <div className="space-y-4">{data?.rows.map(row => <article key={row.id} className="border-t pt-4 space-y-2">
      <div className="flex flex-wrap gap-3 items-center"><strong>{row.name || '이름 미확인'}</strong><span>{data.properties.find(p => p.id === row.propertyId)?.name || '숙소'} · {row.checkIn} ~ {row.checkOut}</span><span className="text-xs bg-stone-100 px-2 py-1">{row.status === 'cancelled' ? '취소 · 집계 제외' : row.status === 'no_show' ? '노쇼 · 집계 제외' : row.status === 'pending' ? '미확정 · 집계 제외' : row.matchStatus === 'review' ? '고객 검토 필요' : row.matchStatus === 'ignored' ? '판별 제외' : row.summary?.isRebooking ? `재예약 · 다른 확정 예약 ${row.summary.confirmedReservations}건` : '기존 확정 예약 없음'}</span></div>
      <p className="text-sm text-stone-500">{row.email || '이메일 없음'} · {row.phone || '전화번호 없음'}</p>
      {row.guestId && <p className="text-sm">연결 고객: {data.guests.find(g => g.id === row.guestId)?.name || row.guestId}</p>}
      <div className="flex flex-wrap gap-2">
        {row.candidateIds.filter(id => id !== row.guestId).map(id => { const candidate = data.guests.find(g => g.id === id); return candidate && <button key={id} disabled={busy} onClick={() => review(row.id, 'link', id)} className="text-sm border px-3 py-2">{candidate.name} · {candidate.phone || candidate.email || '연락처 없음'} — 연결</button>; })}
        {row.matchStatus !== 'new' && <button disabled={busy} onClick={() => review(row.id, 'new')} className="text-sm border px-3 py-2">별도 고객으로 등록</button>}
        {row.matchStatus !== 'ignored' && <button disabled={busy} onClick={() => review(row.id, 'ignore')} className="text-sm border px-3 py-2">판별 제외</button>}
      </div>
    </article>)}</div>
    <div className="flex gap-3"><button disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="border px-3 py-2 disabled:opacity-40">이전</button><button disabled={busy || !data?.hasMore} onClick={() => setOffset(offset + 50)} className="border px-3 py-2 disabled:opacity-40">다음</button></div>
  </section>;
}
