'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Compass, Plus, ChevronRight, Loader2, Briefcase } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { toast } from '@/components/ui';

interface TourListItem {
  id: string;
  title: string;
  slug: string;
  category: string | null;
  basePrice: number | null;
  maxGroupSize: number | null;
  isActive: boolean;
  operator: { id: string; name: string } | null;
  scheduleCount: number;
  bookingCount: number;
}

interface OperatorOption {
  id: string;
  name: string;
}

export default function ToursPage() {
  const { user } = useAuth();
  const [tours, setTours] = useState<TourListItem[]>([]);
  const [operators, setOperators] = useState<OperatorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    title: '',
    operatorId: '',
    basePrice: '',
    maxGroupSize: '',
    durationMin: '',
    meetingPoint: '',
    description: '',
  });

  const fetchData = async () => {
    if (!user) return;
    try {
      const [toursRes, opsRes] = await Promise.all([
        fetch('/api/tours'),
        fetch('/api/tour-operators'),
      ]);
      if (toursRes.ok) setTours(await toursRes.json());
      if (opsRes.ok) setOperators((await opsRes.json()).map((o: OperatorOption) => ({ id: o.id, name: o.name })));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleAdd = async () => {
    if (!form.title.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/api/tours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          operatorId: form.operatorId || null,
          basePrice: form.basePrice ? Number(form.basePrice) : null,
          maxGroupSize: form.maxGroupSize ? Number(form.maxGroupSize) : null,
          durationMin: form.durationMin ? Number(form.durationMin) : null,
          meetingPoint: form.meetingPoint.trim() || null,
          description: form.description.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      setForm({ title: '', operatorId: '', basePrice: '', maxGroupSize: '', durationMin: '', meetingPoint: '', description: '' });
      setIsAddOpen(false);
      await fetchData();
    } catch (err) {
      console.error(err);
      toast.error('투어 추가에 실패했습니다.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 sm:space-y-10">
      <header className="flex flex-col sm:flex-row gap-4 sm:justify-between sm:items-end border-b border-stone-200 pb-6 sm:pb-7">
        <div>
          <p className="text-[13px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">투어 호스팅</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">투어 상품</h1>
          <p className="text-stone-500 mt-2 text-sm">북촌 주변 투어 상품을 등록하고 일정·재고를 관리합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/tour-operators"
            className="text-xs uppercase tracking-widest font-medium text-stone-700 hover:text-stone-900 border border-stone-200 hover:border-stone-300 px-4 py-2.5 inline-flex items-center gap-2 transition-colors"
          >
            <Briefcase size={13} /> 운영업체
          </Link>
          <button
            onClick={() => setIsAddOpen(true)}
            className="bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white text-xs font-semibold uppercase tracking-widest px-5 py-2.5 flex items-center justify-center gap-2 active:scale-[0.98] transition-colors shrink-0"
          >
            <Plus size={15} /> 투어 추가
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={20} className="animate-spin text-[var(--brand)]" />
        </div>
      ) : tours.length === 0 ? (
        <div className="text-center py-20 bg-white border border-dashed border-stone-200">
          <Compass size={28} strokeWidth={1.5} className="mx-auto mb-4 text-stone-300" />
          <p className="text-stone-500 text-sm mb-1">등록된 투어가 없습니다.</p>
          <p className="text-stone-400 text-xs">첫 번째 투어를 추가하세요.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tours.map(tour => (
            <Link
              key={tour.id}
              href={`/admin/tours/${tour.id}`}
              className="group bg-white hover:bg-stone-50 border border-stone-200 hover:border-stone-300 p-5 sm:p-6 active:scale-[0.99] transition-all flex flex-col"
            >
              <div className="flex justify-between items-start mb-5">
                <div className="w-10 h-10 bg-[var(--brand-tint)] flex items-center justify-center text-[var(--brand-dark)]">
                  <Compass size={18} strokeWidth={1.7} />
                </div>
                <ChevronRight size={18} className="text-stone-300 group-hover:text-stone-700 transition-colors" />
              </div>
              <h2 className="text-base sm:text-lg font-semibold text-stone-900 mb-1 truncate">{tour.title}</h2>
              <p className="text-xs text-stone-500 mb-3 truncate">
                {tour.operator?.name ?? '업체 미지정'}
                {tour.basePrice ? ` · ${tour.basePrice.toLocaleString()}원` : ''}
              </p>
              <div className="mt-auto flex items-center justify-between text-[13px] text-stone-400 tracking-wide">
                <span>일정 {tour.scheduleCount} · 예약 {tour.bookingCount}</span>
                <span className={tour.isActive ? 'text-emerald-600' : 'text-stone-400'}>
                  {tour.isActive ? '판매중' : '비활성'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {isAddOpen && (
        <div className="fixed inset-0 bg-stone-950/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 backdrop-blur-sm">
          <div className="bg-white border border-stone-200 p-6 sm:p-8 w-full sm:max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-stone-900 mb-2">새 투어 추가</h2>
            <p className="text-stone-500 text-sm mb-5">기본 정보를 입력하세요. 일정·재고는 다음 화면에서 설정합니다.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">투어명 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="예) 북촌 한복투어 2시간"
                  className="w-full bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">운영업체</label>
                <select
                  value={form.operatorId}
                  onChange={e => setForm({ ...form, operatorId: e.target.value })}
                  className="w-full bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                >
                  <option value="">미지정</option>
                  {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">가격(원)</label>
                  <input
                    type="number"
                    value={form.basePrice}
                    onChange={e => setForm({ ...form, basePrice: e.target.value })}
                    placeholder="40000"
                    className="w-full bg-white border border-stone-200 px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">정원</label>
                  <input
                    type="number"
                    value={form.maxGroupSize}
                    onChange={e => setForm({ ...form, maxGroupSize: e.target.value })}
                    placeholder="6"
                    className="w-full bg-white border border-stone-200 px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">시간(분)</label>
                  <input
                    type="number"
                    value={form.durationMin}
                    onChange={e => setForm({ ...form, durationMin: e.target.value })}
                    placeholder="120"
                    className="w-full bg-white border border-stone-200 px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">모임장소</label>
                <input
                  type="text"
                  value={form.meetingPoint}
                  onChange={e => setForm({ ...form, meetingPoint: e.target.value })}
                  placeholder="예) 안국역 2번 출구"
                  className="w-full bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                />
              </div>
              <div>
                <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">설명</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  placeholder="투어 소개"
                  className="w-full bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setIsAddOpen(false)}
                className="px-5 py-2.5 text-stone-700 hover:text-stone-900 text-sm font-medium transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleAdd}
                disabled={!form.title.trim() || adding}
                className="px-5 py-2.5 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-50"
              >
                {adding ? '추가 중...' : '추가하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
