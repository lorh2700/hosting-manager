'use client';
import { useEffect, useState } from 'react';
import type { GuestRegion } from '@/lib/guest-region';
import { Search, Users, ArrowLeft } from 'lucide-react';
import { GuestHistoryReview } from '@/components/GuestHistoryReview';

type Customer = { region: GuestRegion; id: string; name: string | null; email: string | null; phone: string | null; source: string | null; bookingCount: number; pastReservations: number; completedStays: number; lastReservationDate: string | null; propertyIds: string[] };
type Property = { id: string; name: string };
type Directory = { rows: Customer[]; total: number; page: number; pageSize: number; properties: Property[]; reviewCount: number };
type Detail = { guest: { region: GuestRegion; id: string; name: string | null; email: string | null; phone: string | null; notes: string | null }; rows: { id: string; propertyId: string; checkIn: string; checkOut: string; status: string; source: string }[]; total: number; page: number; pageSize: number; properties: Property[] };
const statuses: Record<string, string> = { confirmed: '예약 확정', completed: '숙박 완료 확인', cancelled: '취소', no_show: '노쇼', pending: '미확정', unknown: '상태 확인 필요', blocked: '차단' };
const button = 'min-h-11 border border-stone-300 px-4 py-2 text-sm hover:bg-stone-100 disabled:opacity-40 disabled:cursor-not-allowed';

export default function GuestsPage() {
  const [tab, setTab] = useState<'directory' | 'review'>('directory');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('past');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  const [data, setData] = useState<Directory | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { const timer = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    if (tab !== 'directory') return;
    const controller = new AbortController(); setLoading(true); setError(''); setNotice('');
    const params = selected ? new URLSearchParams({ id: selected, page: String(detailPage) }) : new URLSearchParams({ q, filter, page: String(page) });
    void fetch(`/api/guests/directory?${params}`, { signal: controller.signal, cache: 'no-store' }).then(async res => {
      if (!res.ok) throw new Error(res.status === 403 ? '고객 명부는 관리자만 조회할 수 있습니다.' : '고객 정보를 불러오지 못했습니다. 다시 시도해주세요.');
      const result = await res.json();
      if (controller.signal.aborted) return;
      if (selected) { setDetail(result); setNotes(result.guest.notes || ''); } else setData(result);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tab, q, filter, page, selected, detailPage, refresh]);
  async function saveNotes() {
    if (!selected) return;
    setSaving(true); setNotice('');
    try {
      const res = await fetch('/api/guests', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected, notes }) });
      if (!res.ok) throw new Error('메모를 저장하지 못했습니다.');
      setNotice('메모를 저장했습니다.');
    } catch(e) { setNotice(e instanceof Error ? e.message : '저장 오류'); } finally { setSaving(false); }
  }
  return <div className="max-w-6xl mx-auto space-y-6">
    <header className="border-b border-stone-200 pb-6"><p className="text-xs tracking-widest text-stone-500 mb-3">GUESTS</p><h1 className="text-3xl font-light">고객 명부</h1><p className="text-sm text-stone-500 mt-3 leading-6">이름·전화번호·이메일로 고객을 찾고, 지점별 예약 이력을 확인하세요.</p></header>
    <div className="flex gap-2" aria-label="고객 관리 보기"><button className={`${button} ${tab === 'directory' ? 'bg-stone-900 text-white hover:bg-stone-800' : ''}`} aria-pressed={tab === 'directory'} onClick={() => setTab('directory')}>고객 목록</button><button className={`${button} ${tab === 'review' ? 'bg-stone-900 text-white hover:bg-stone-800' : ''}`} aria-pressed={tab === 'review'} onClick={() => setTab('review')}>재예약 검토{data ? ` · ${data.reviewCount}` : ''}</button></div>
    {tab === 'review' ? <GuestHistoryReview /> : <>
      {selected ? <button className={`${button} inline-flex items-center gap-2`} disabled={saving} onClick={() => { setSelected(null); setDetail(null); }}><ArrowLeft size={16} />고객 목록으로</button> : <>
        <div className="flex flex-col sm:flex-row gap-3"><div className="relative flex-1"><Search size={18} aria-hidden="true" className="absolute left-4 top-4 text-stone-400" /><input aria-label="고객 검색" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="이름, 전화번호, 이메일 검색" maxLength={200} className="w-full min-h-12 border border-stone-300 bg-white pl-11 pr-4 text-sm" /></div><select aria-label="예약 이력 필터" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }} className="min-h-12 border border-stone-300 bg-white px-4 text-sm"><option value="past">지난 예약이 있는 고객</option><option value="all">전체 고객</option><option value="completed">숙박 완료 확인 고객</option></select></div>
        <p className="text-xs text-stone-500 leading-6">‘지난 예약’은 체크아웃 날짜가 지난 확정 예약입니다. 실제 숙박 완료 여부와는 다르며, 취소·노쇼는 횟수에서 제외합니다. 국가·지역은 예약 거주지를 우선하며, 없으면 전화번호로 추정합니다. 국적을 의미하지 않습니다. 고객 연결이 필요한 예약은 ‘재예약 검토’에서 확인하세요.</p>
      </>}
      {loading ? <p role="status" className="py-12 text-center text-stone-500">고객 정보를 불러오는 중…</p> : error ? <div role="alert" className="border border-red-200 bg-red-50 p-5 text-red-800">{error}<button className={`${button} ml-3`} onClick={() => setRefresh(v => v + 1)}>다시 시도</button></div> : selected && detail ? <>
        <section className="bg-white border border-stone-200 p-5 sm:p-7 space-y-4"><h2 className="text-2xl">{detail.guest.name || '이름 미확인'}</h2><div className="text-sm text-stone-600 space-y-2 break-words"><p>전화번호 · {detail.guest.phone || '미등록'}</p><p>국가·지역 · {detail.guest.region.label} ({detail.guest.region.source === 'reservation' ? '예약 거주지' : detail.guest.region.source === 'phone' ? '전화번호 추정' : '정보 없음'})</p><p>이메일 · {detail.guest.email || '미등록'}</p></div><label htmlFor="customer-note" className="block text-sm">고객 메모</label><textarea id="customer-note" maxLength={2000} rows={3} value={notes} onChange={e => setNotes(e.target.value)} className="w-full border border-stone-300 p-3 text-sm" /><button onClick={saveNotes} disabled={saving} className={button}>{saving ? '저장 중…' : '메모 저장'}</button>{notice && <p role="status" className="text-sm">{notice}</p>}</section>
        <section className="space-y-3"><h2 className="text-lg font-medium">예약 이력 · {detail.total}건</h2>{detail.rows.length === 0 ? <p className="p-6 bg-white border">연결된 예약이 없습니다.</p> : detail.rows.map(row => <article key={row.id} className="bg-white border border-stone-200 p-5 flex flex-wrap justify-between gap-3"><div><h3 className="font-medium">{detail.properties.find(p => p.id === row.propertyId)?.name || '숙소 정보 없음'}</h3><p className="text-sm mt-2">{row.checkIn} ~ {row.checkOut}</p><p className="text-xs text-stone-500 mt-2">{row.source}</p></div><span className="text-sm">{statuses[row.status] || '상태 확인 필요'}</span></article>)}<Pagination page={detailPage} total={detail.total} size={detail.pageSize} onPage={setDetailPage} disabled={saving} /></section>
      </> : data && <>
        <p aria-live="polite" className="text-sm text-stone-600">검색 결과 {data.total}명</p>
        {data.rows.length === 0 ? <div className="py-16 border bg-white text-center text-stone-500"><Users size={28} className="mx-auto mb-3" /><p>조건에 맞는 고객이 없습니다.</p></div> : <div className="border border-stone-200 bg-white">
          <div role="region" aria-label="고객 목록 테이블, 작은 화면에서는 좌우로 스크롤할 수 있습니다" tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2">
            <table className="w-full min-w-[1000px] text-sm text-left">
              <caption className="sr-only">고객 검색 결과 {data.total}명 중 {data.rows.length}명</caption>
              <thead className="bg-stone-100 text-xs text-stone-600">
                <tr>{['고객명', '연락처', '국가·지역', '확정 예약', '지난 예약', '최근 지난 예약일', '이용 숙소', '상세'].map(label => <th key={label} scope="col" className="px-4 py-4 font-medium whitespace-nowrap">{label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {data.rows.map(guest => <tr key={guest.id} className="hover:bg-stone-50 transition-colors">
                  <th scope="row" className="px-4 py-3 font-medium min-w-36">
                    <button onClick={() => { setSelected(guest.id); setDetailPage(1); }} className="min-h-11 text-left underline underline-offset-4 decoration-stone-300 hover:decoration-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2">{guest.name || '이름 미확인'}</button>
                    {guest.bookingCount > 1 && <span className="block w-fit text-[11px] font-normal bg-emerald-50 text-emerald-800 px-2 py-1">재예약</span>}
                  </th>
                  <td className="px-4 py-3 min-w-56"><p className="whitespace-nowrap">{guest.phone || '전화번호 미등록'}</p><p className="text-xs text-stone-500 mt-1 break-all max-w-72">{guest.email || '이메일 미등록'}</p></td>
                  <td className="px-4 py-3 min-w-40"><p>{guest.region.label}</p><p className="text-xs text-stone-500 mt-1">{guest.region.source === 'reservation' ? '예약 거주지' : guest.region.source === 'phone' ? '전화번호 추정' : '정보 없음'}</p></td>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">{guest.bookingCount}건</td>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">{guest.pastReservations}건</td>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">{guest.lastReservationDate || '—'}</td>
                  <td className="px-4 py-3 min-w-40 max-w-60 text-stone-600 leading-6">{guest.propertyIds.map(id => data.properties.find(p => p.id === id)?.name || '숙소').join(' · ') || '—'}</td>
                  <td className="px-4 py-3"><button aria-label={`${guest.name || '이름 미확인'} 고객 예약 이력 보기`} onClick={() => { setSelected(guest.id); setDetailPage(1); }} className={`${button} whitespace-nowrap`}>이력 보기</button></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <p className="md:hidden px-4 py-3 text-xs text-stone-500 border-t">좌우로 스크롤하면 전체 항목을 볼 수 있습니다.</p>
        </div>}

        <Pagination page={page} total={data.total} size={data.pageSize} onPage={setPage} />
      </>}
    </>}
  </div>;
}
function Pagination({ page, total, size, onPage, disabled = false }: { page: number; total: number; size: number; onPage: (page: number) => void; disabled?: boolean }) {
  return <div className="flex items-center justify-between gap-3 pt-4"><button className={button} disabled={disabled || page === 1} onClick={() => onPage(page - 1)}>이전</button><span className="text-sm text-stone-500">{page} / {Math.max(1, Math.ceil(total / size))}</span><button className={button} disabled={disabled || page * size >= total} onClick={() => onPage(page + 1)}>다음</button></div>;
}
