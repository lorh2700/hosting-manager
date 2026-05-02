'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, Loader2, RefreshCw, X, Phone, Mail, MessageSquare, CheckCircle2, Clock as ClockIcon } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useAuth } from '@/components/AuthProvider';

interface TourBooking {
  id: string;
  tourId: string;
  name: string;
  phone: string;
  email: string | null;
  guests: number;
  durationMin: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  status: string;
  forwardedAt: string | null;
  message: string | null;
  source: string;
  createdAt: string;
  tour: {
    id: string;
    title: string;
    operator: { id: string; name: string; contactPhone: string | null; email: string | null } | null;
  };
  schedule: { date: string; startTime: string };
  durationOption: { id: string; label: string | null; durationMin: number; price: number } | null;
}

function formatDuration(min: number): string {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

const STATUS_TABS = [
  { value: '', label: '전체' },
  { value: 'pending', label: '대기' },
  { value: 'forwarded', label: '전달완료' },
  { value: 'confirmed', label: '확정' },
  { value: 'cancelled', label: '취소' },
];

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  forwarded: 'bg-blue-50 text-blue-700 border-blue-200',
  confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-stone-100 text-stone-500 border-stone-200',
  completed: 'bg-stone-100 text-stone-700 border-stone-300',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  forwarded: '전달완료',
  confirmed: '확정',
  cancelled: '취소',
  completed: '완료',
};

function TourBookingsContent() {
  const search = useSearchParams();
  const initialTourId = search.get('tourId') ?? '';
  const { user } = useAuth();
  const [bookings, setBookings] = useState<TourBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [tourIdFilter, setTourIdFilter] = useState(initialTourId);
  const [forwarding, setForwarding] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchBookings = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tourIdFilter) params.set('tourId', tourIdFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/tour-bookings?${params}`);
      if (res.ok) setBookings(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBookings(); /* eslint-disable-next-line */ }, [user, statusFilter, tourIdFilter]);

  const handleForward = async (id: string) => {
    setForwarding(id);
    try {
      const res = await fetch(`/api/tour-bookings/${id}/forward`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      await fetchBookings();
    } catch (err) {
      console.error(err);
      alert('재전달에 실패했습니다.');
    } finally {
      setForwarding(null);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    if (status === 'cancelled' && !confirm('이 예약을 취소하시겠습니까? 슬롯 정원이 회복됩니다.')) return;
    setUpdating(id);
    try {
      const res = await fetch('/api/tour-bookings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error('Failed');
      await fetchBookings();
    } catch (err) {
      console.error(err);
      alert('상태 변경에 실패했습니다.');
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-stone-200 pb-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-2">투어 호스팅</p>
          <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-stone-900">투어 예약 관리</h1>
        </div>
        <Link
          href="/admin/tours"
          className="text-xs uppercase tracking-widest text-stone-700 hover:text-stone-900 border border-stone-200 hover:border-stone-300 px-4 py-2 inline-flex items-center gap-2 transition-colors self-start sm:self-auto"
        >
          투어 상품
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 pb-3">
        {STATUS_TABS.map(t => (
          <button
            key={t.value}
            onClick={() => setStatusFilter(t.value)}
            className={`text-xs px-3 py-1.5 border tracking-wide transition-colors ${
              statusFilter === t.value
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
            }`}
          >
            {t.label}
          </button>
        ))}
        {tourIdFilter && (
          <button
            onClick={() => setTourIdFilter('')}
            className="ml-auto text-xs text-stone-500 hover:text-stone-900 inline-flex items-center gap-1"
          >
            <X size={11} /> 투어 필터 해제
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={20} className="animate-spin text-[var(--brand)]" />
        </div>
      ) : bookings.length === 0 ? (
        <div className="bg-white border border-dashed border-stone-200 p-16 text-center">
          <BookOpen size={28} strokeWidth={1.5} className="mx-auto mb-4 text-stone-300" />
          <p className="text-sm text-stone-500">조건에 맞는 예약이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map(b => (
            <div key={b.id} className="bg-white border border-stone-200 p-5 sm:p-6 hover:border-stone-300 transition-colors">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                  <Link href={`/admin/tours/${b.tourId}`} className="text-sm font-medium text-stone-900 hover:underline">
                    {b.tour.title}
                  </Link>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {format(parseISO(b.schedule.date), 'yyyy년 M월 d일 (E)', { locale: ko })} · {b.schedule.startTime}
                    {b.durationMin && (
                      <>
                        <span className="mx-1.5">·</span>
                        <span className="text-stone-700">{formatDuration(b.durationMin)} 코스</span>
                        {b.durationOption?.label && <span className="text-stone-400"> ({b.durationOption.label})</span>}
                      </>
                    )}
                    <span className="mx-1.5">·</span>
                    {b.guests}명
                    {b.totalPrice !== null && (
                      <span className="ml-2 text-stone-700 font-medium">
                        {b.totalPrice.toLocaleString()}원
                        {b.unitPrice !== null && <span className="text-stone-400 font-normal"> ({b.unitPrice.toLocaleString()}원/인)</span>}
                      </span>
                    )}
                  </p>
                </div>
                <span className={`text-[10px] uppercase tracking-widest px-2.5 py-1 border ${STATUS_BADGE[b.status] ?? 'border-stone-200 text-stone-600'}`}>
                  {STATUS_LABEL[b.status] ?? b.status}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-stone-600 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-stone-400">예약자</span>
                  <span className="text-stone-900 font-medium">{b.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone size={11} />
                  <a href={`tel:${b.phone}`} className="hover:text-stone-900">{b.phone}</a>
                </div>
                {b.email && (
                  <div className="flex items-center gap-2">
                    <Mail size={11} />
                    <a href={`mailto:${b.email}`} className="hover:text-stone-900">{b.email}</a>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <ClockIcon size={11} />
                  <span>접수 {format(parseISO(b.createdAt), 'M/d HH:mm', { locale: ko })}</span>
                </div>
                {b.tour.operator && (
                  <div className="sm:col-span-2 flex items-center gap-2 pt-2 border-t border-stone-100 mt-1">
                    <span className="text-stone-400">운영업체</span>
                    <span className="text-stone-700">{b.tour.operator.name}</span>
                    {b.tour.operator.contactPhone && (
                      <a href={`tel:${b.tour.operator.contactPhone}`} className="text-stone-500 hover:text-stone-900">
                        {b.tour.operator.contactPhone}
                      </a>
                    )}
                  </div>
                )}
                {b.message && (
                  <div className="sm:col-span-2 flex items-start gap-2 pt-2 border-t border-stone-100 mt-1">
                    <MessageSquare size={11} className="mt-0.5 text-stone-400" />
                    <span className="text-stone-700 whitespace-pre-line">{b.message}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-stone-100">
                {b.status !== 'cancelled' && (
                  <>
                    <button
                      onClick={() => handleForward(b.id)}
                      disabled={forwarding === b.id}
                      className="text-xs text-stone-700 hover:text-stone-900 border border-stone-200 hover:border-stone-300 px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw size={11} className={forwarding === b.id ? 'animate-spin' : ''} />
                      {b.status === 'forwarded' ? '재전달' : '업체 전달'}
                    </button>
                    {b.status !== 'confirmed' && (
                      <button
                        onClick={() => handleStatusChange(b.id, 'confirmed')}
                        disabled={updating === b.id}
                        className="text-xs text-emerald-700 hover:text-emerald-900 border border-emerald-200 hover:border-emerald-300 px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <CheckCircle2 size={11} /> 확정 처리
                      </button>
                    )}
                    <button
                      onClick={() => handleStatusChange(b.id, 'cancelled')}
                      disabled={updating === b.id}
                      className="ml-auto text-xs text-stone-500 hover:text-red-600 border border-transparent hover:border-red-200 px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <X size={11} /> 취소
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TourBookingsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24"><Loader2 size={20} className="animate-spin text-[var(--brand)]" /></div>}>
      <TourBookingsContent />
    </Suspense>
  );
}
