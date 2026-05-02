'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Compass,
  CalendarCheck,
  Briefcase,
  Clock,
  Users as UsersIcon,
  Loader2,
  Plus,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useAuth } from '@/components/AuthProvider';

interface ScheduleSummary {
  id: string;
  date: string;
  startTime: string;
  capacity: number;
  bookedCount: number;
  status: string;
  tour: { id: string; title: string };
  bookings: { id: string; name: string; guests: number; status: string; phone: string }[];
}

interface BookingSummary {
  id: string;
  name: string;
  phone: string;
  guests: number;
  status: string;
  createdAt: string;
  tour: { id: string; title: string };
  schedule: { date: string; startTime: string };
}

interface DashboardData {
  activeTourCount: number;
  operatorCount: number;
  weekBookingCount: number;
  pendingCount: number;
  todaySchedules: ScheduleSummary[];
  recentBookings: BookingSummary[];
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  forwarded: 'bg-blue-50 text-blue-800 ring-blue-200',
  confirmed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  cancelled: 'bg-stone-100 text-stone-500 ring-stone-300',
  completed: 'bg-stone-100 text-stone-700 ring-stone-300',
};
const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  forwarded: '전달완료',
  confirmed: '확정',
  cancelled: '취소',
  completed: '완료',
};

function StatusPill({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? 'bg-stone-100 text-stone-700 ring-stone-300';
  const label = STATUS_LABEL[status] ?? status;
  return (
    <span className={`inline-flex items-center px-2 py-1 ring-1 text-[10px] leading-none uppercase tracking-widest ${cls}`}>
      {label}
    </span>
  );
}

export default function TourDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await fetch('/api/tour-dashboard');
        if (res.ok) setData(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const todayPeople =
    data?.todaySchedules.reduce((sum, s) => sum + s.bookedCount, 0) ?? 0;
  const todayCapacity =
    data?.todaySchedules.reduce((sum, s) => sum + s.capacity, 0) ?? 0;

  const stats = [
    { label: '활성 투어', value: data?.activeTourCount ?? 0, icon: Compass, href: '/admin/tours' },
    { label: '오늘 예약 인원', value: todayPeople, icon: UsersIcon, href: '/admin/tour-bookings' },
    { label: '이번주 예약', value: data?.weekBookingCount ?? 0, icon: CalendarCheck, href: '/admin/tour-bookings' },
    { label: '대기 예약', value: data?.pendingCount ?? 0, icon: Clock, href: '/admin/tour-bookings?status=pending' },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-8 sm:space-y-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">투어 호스팅</p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-stone-900 tracking-tight">
            {format(new Date(), 'M월 d일 EEEE', { locale: ko })}
          </h1>
          <p className="text-stone-500 text-sm mt-2">
            {loading
              ? '불러오는 중...'
              : `${data?.activeTourCount ?? 0}개 투어 · ${data?.operatorCount ?? 0}곳 운영업체`}
          </p>
        </div>
        <Link
          href="/admin/tours"
          className="hidden sm:inline-flex items-center gap-1.5 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white text-xs font-semibold uppercase tracking-widest px-4 py-2.5 transition-colors"
        >
          <Plus size={14} /> 투어 추가
        </Link>
      </header>

      {loading && (
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="bg-stone-100 h-[78px]" />
            ))}
          </div>
          <div className="bg-stone-100 h-12" />
          <div className="bg-stone-100 h-48" />
        </div>
      )}

      {!loading && data && (
        <>
          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-px bg-stone-200 border border-stone-200">
            {stats.map(item => {
              const Icon = item.icon;
              const active = item.value > 0;
              return active ? (
                <Link
                  key={item.label}
                  href={item.href}
                  className="bg-[var(--brand-tint)] p-4 sm:p-5 flex items-center gap-3 hover:bg-[var(--brand-tint-strong)] active:scale-[0.99] transition-colors"
                >
                  <div className="w-9 h-9 bg-white flex items-center justify-center shrink-0 ring-1 ring-[var(--brand)]/30">
                    <Icon size={17} className="text-[var(--brand)]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl font-semibold text-stone-900 tabular-nums leading-none">{item.value}</p>
                    <p className="text-[11px] uppercase tracking-widest text-stone-500 mt-1.5">{item.label}</p>
                  </div>
                </Link>
              ) : (
                <div key={item.label} className="bg-white p-4 sm:p-5 flex items-center gap-3">
                  <div className="w-9 h-9 bg-stone-100 flex items-center justify-center shrink-0">
                    <Icon size={17} className="text-stone-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl font-semibold text-stone-300 tabular-nums leading-none">0</p>
                    <p className="text-[11px] uppercase tracking-widest text-stone-400 mt-1.5">{item.label}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Today summary bar */}
          <div className="border-t border-b border-stone-200 py-3 flex items-center gap-x-5 sm:gap-x-7 gap-y-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.25em] text-stone-400">오늘</span>
            <span className="flex items-baseline gap-1.5">
              <span className={`text-lg font-semibold tabular-nums ${data.todaySchedules.length > 0 ? 'text-stone-900' : 'text-stone-300'}`}>
                {data.todaySchedules.length}
              </span>
              <span className="text-[11px] uppercase tracking-widest text-stone-500">슬롯</span>
            </span>
            <span className="text-stone-300">/</span>
            <span className="flex items-baseline gap-1.5">
              <span className={`text-lg font-semibold tabular-nums ${todayPeople > 0 ? 'text-stone-900' : 'text-stone-300'}`}>
                {todayPeople}
              </span>
              <span className="text-[11px] uppercase tracking-widest text-stone-500">예약 인원</span>
            </span>
            <span className="text-stone-300">/</span>
            <span className="flex items-baseline gap-1.5">
              <span className={`text-lg font-semibold tabular-nums ${todayCapacity > 0 ? 'text-stone-900' : 'text-stone-300'}`}>
                {todayCapacity}
              </span>
              <span className="text-[11px] uppercase tracking-widest text-stone-500">총 정원</span>
            </span>
          </div>

          {/* Today's schedules */}
          {data.todaySchedules.length > 0 ? (
            <div className="bg-white border border-stone-200 overflow-hidden">
              <div className="px-5 sm:px-6 py-4 border-b border-stone-200 flex items-center gap-3">
                <div>
                  <p className="text-base sm:text-lg text-stone-900 font-semibold tracking-tight">오늘의 투어</p>
                  <p className="text-xs text-stone-500 mt-0.5">{format(new Date(), 'M월 d일 (EEE)', { locale: ko })}</p>
                </div>
                <span className="ml-auto text-[10px] uppercase tracking-widest text-[var(--brand)] bg-[var(--brand-tint)] px-2.5 py-1 font-semibold">오늘</span>
              </div>
              <div className="divide-y divide-stone-200">
                {data.todaySchedules.map(s => (
                  <div key={s.id} className="px-5 sm:px-6 py-4">
                    <div className="flex items-start gap-3 mb-2">
                      <div className="text-sm font-mono font-medium text-stone-900 w-14 shrink-0 pt-0.5">{s.startTime}</div>
                      <div className="flex-1 min-w-0">
                        <Link href={`/admin/tours/${s.tour.id}`} className="text-sm font-medium text-stone-900 hover:underline">
                          {s.tour.title}
                        </Link>
                        <p className="text-xs text-stone-500 mt-0.5">
                          {s.bookedCount} / {s.capacity}명
                          {s.status !== 'open' && <span className="ml-2 text-rose-600">· 마감</span>}
                        </p>
                      </div>
                    </div>
                    {s.bookings.length > 0 && (
                      <div className="ml-[68px] space-y-1">
                        {s.bookings.map(b => (
                          <div key={b.id} className="flex items-center gap-2 text-xs text-stone-600">
                            <span className="text-stone-900">{b.name}</span>
                            <span className="text-stone-400">·</span>
                            <span>{b.guests}명</span>
                            <span className="text-stone-400">·</span>
                            <a href={`tel:${b.phone}`} className="text-stone-500 hover:text-stone-900">{b.phone}</a>
                            <span className="ml-auto"><StatusPill status={b.status} /></span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-dashed border-stone-200 py-10 text-center">
              <Compass size={28} strokeWidth={1.5} className="mx-auto mb-4 text-stone-300" />
              <p className="text-stone-500 text-sm mb-3">오늘 운영하는 투어가 없습니다.</p>
              <Link href="/admin/tours" className="text-stone-700 hover:text-stone-900 text-xs inline-flex items-center gap-1 transition-colors">
                투어 일정 관리하기 <ArrowRight size={12} />
              </Link>
            </div>
          )}

          {/* Recent bookings */}
          <div>
            <div className="flex items-end justify-between mb-3">
              <h2 className="text-sm tracking-widest font-medium text-stone-900">최근 예약</h2>
              <Link href="/admin/tour-bookings" className="text-stone-500 hover:text-stone-900 text-xs inline-flex items-center gap-1 transition-colors">
                전체 보기 <ArrowRight size={12} />
              </Link>
            </div>
            {data.recentBookings.length === 0 ? (
              <div className="bg-white border border-dashed border-stone-200 py-10 text-center">
                <CalendarCheck size={26} strokeWidth={1.5} className="mx-auto mb-3 text-stone-300" />
                <p className="text-stone-500 text-sm">아직 들어온 예약이 없습니다.</p>
              </div>
            ) : (
              <div className="bg-white border border-stone-200 divide-y divide-stone-200">
                {data.recentBookings.map(b => (
                  <div key={b.id} className="px-4 sm:px-5 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/admin/tours/${b.tour.id}`} className="text-sm text-stone-900 hover:underline truncate">
                          {b.tour.title}
                        </Link>
                        <StatusPill status={b.status} />
                      </div>
                      <p className="text-xs text-stone-500 mt-0.5">
                        {format(parseISO(b.schedule.date), 'M월 d일 (EEE)', { locale: ko })} · {b.schedule.startTime}
                        <span className="mx-1.5 text-stone-300">·</span>
                        {b.name} ({b.guests}명)
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link href="/admin/tours" className="bg-white border border-stone-200 hover:border-[var(--brand)] p-4 flex items-center gap-3 transition-colors group">
              <Compass size={18} className="text-stone-400 group-hover:text-[var(--brand)]" />
              <span className="text-sm text-stone-900">투어 상품</span>
              <ArrowRight size={14} className="ml-auto text-stone-300 group-hover:text-[var(--brand)]" />
            </Link>
            <Link href="/admin/tour-bookings" className="bg-white border border-stone-200 hover:border-[var(--brand)] p-4 flex items-center gap-3 transition-colors group">
              <CalendarCheck size={18} className="text-stone-400 group-hover:text-[var(--brand)]" />
              <span className="text-sm text-stone-900">투어 예약</span>
              <ArrowRight size={14} className="ml-auto text-stone-300 group-hover:text-[var(--brand)]" />
            </Link>
            <Link href="/admin/tour-operators" className="bg-white border border-stone-200 hover:border-[var(--brand)] p-4 flex items-center gap-3 transition-colors group">
              <Briefcase size={18} className="text-stone-400 group-hover:text-[var(--brand)]" />
              <span className="text-sm text-stone-900">운영업체</span>
              <ArrowRight size={14} className="ml-auto text-stone-300 group-hover:text-[var(--brand)]" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
