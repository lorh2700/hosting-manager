'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { BookOpen, X, CheckCircle2, Clock, Filter, Plus, Loader2 } from 'lucide-react';

interface PropertyInfo {
  id: string;
  name: string;
  beds24PropId?: string | null;
}

interface Booking {
  id: string;
  propertyId: string;
  propertyName: string;
  name: string;
  email: string;
  phone?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  adults?: number;
  children?: number;
  status: 'confirmed' | 'cancelled' | 'pending';
  createdAt: string;
  source: string;
  channelBookingRef?: string;
  dataSource: 'bookings' | 'events';
  description?: string;
}

type StatusFilter = 'all' | 'confirmed' | 'cancelled';
type SourceFilter = 'all' | 'direct' | 'ota';

function parseEventDescription(desc: string): { name: string; email: string; phone: string; guests: number } {
  const result = { name: '게스트', email: '', phone: '', guests: 1 };
  if (!desc) return result;
  const lines = desc.split('\n');
  for (const line of lines) {
    if (line.startsWith('게스트: ')) result.name = line.replace('게스트: ', '').trim();
    if (line.startsWith('이메일: ')) result.email = line.replace('이메일: ', '').trim();
    if (line.startsWith('연락처: ')) result.phone = line.replace('연락처: ', '').trim();
    if (line.startsWith('인원: ')) {
      const match = line.match(/성인\s*(\d+)/);
      const childMatch = line.match(/아동\s*(\d+)/);
      result.guests = (match ? Number(match[1]) : 1) + (childMatch ? Number(childMatch[1]) : 0);
    }
  }
  return result;
}

function getSourceLabel(source: string): string {
  const map: Record<string, string> = {
    direct: '직접',
    beds24: 'Beds24',
    Airbnb: 'Airbnb',
    'Booking.com': 'Booking.com',
    Stayfolio: 'Stayfolio',
    Agoda: 'Agoda',
    Naver: 'Naver',
  };
  return map[source] || source || '직접';
}

function getSourceBadgeClass(_source: string): string {
  return 'bg-white/[0.06] text-white/75 border-white/[0.08]';
}

export default function BookingsPage() {
  const { user, profile } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [properties, setProperties] = useState<Map<string, PropertyInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('confirmed');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [propertyFilter, setPropertyFilter] = useState<string>('all');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmCancelBooking, setConfirmCancelBooking] = useState<Booking | null>(null);

  // Create booking modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    propertyId: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    numAdult: 1,
    numChild: 0,
    arrival: '',
    departure: '',
    notes: '',
  });
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const fetchData = async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/admin/bookings');
      if (!res.ok) throw new Error('Failed to fetch bookings data');
      const data = await res.json();

      const propsMap = new Map<string, PropertyInfo>();
      (data.properties ?? []).forEach((d: any) => {
        propsMap.set(d.id, {
          id: d.id,
          name: d.name,
          beds24PropId: d.beds24PropId || null,
        });
      });
      setProperties(propsMap);

      const allBookings: Booking[] = [];
      const bookingRefSet = new Set<string>();

      (data.bookings ?? []).forEach((d: any) => {
        const propInfo = propsMap.get(d.propertyId);
        const ref = d.channelBookingRef;
        if (ref) bookingRefSet.add(String(ref));

        allBookings.push({
          id: d.id,
          propertyId: d.propertyId,
          propertyName: propInfo?.name ?? '알 수 없는 숙소',
          name: d.name ?? '',
          email: d.email ?? '',
          phone: d.phone ?? '',
          checkIn: d.checkIn ?? '',
          checkOut: d.checkOut ?? '',
          guests: d.guests ?? 1,
          adults: d.adults,
          children: d.children,
          status: d.status ?? 'pending',
          createdAt: d.createdAt ?? '',
          source: d.channelId === 'beds24' ? 'beds24' : 'direct',
          channelBookingRef: ref ? String(ref) : undefined,
          dataSource: 'bookings',
        });
      });

      (data.events ?? []).forEach((d: any) => {
        const uid = d.originalUid ? String(d.originalUid) : '';

        // Deduplicate: skip if already in bookings via channelBookingRef
        if (uid && bookingRefSet.has(uid)) return;

        const propInfo = propsMap.get(d.propertyId);
        const parsed = parseEventDescription(d.description || '');

        allBookings.push({
          id: d.id,
          propertyId: d.propertyId,
          propertyName: propInfo?.name ?? '알 수 없는 숙소',
          name: d.title || parsed.name,
          email: parsed.email,
          phone: parsed.phone,
          checkIn: d.startDate ?? '',
          checkOut: d.endDate ?? '',
          guests: parsed.guests,
          status: 'confirmed',
          createdAt: d.createdAt ?? '',
          source: d.source || d.channelId || 'ota',
          channelBookingRef: uid || undefined,
          dataSource: 'events',
          description: d.description,
        });
      });

      allBookings.sort((a, b) => {
        // Sort by checkIn date descending
        return (b.checkIn || '').localeCompare(a.checkIn || '');
      });
      setBookings(allBookings);
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const handleCancelBooking = async (booking: Booking) => {
    setCancellingId(booking.id);
    try {
      if (booking.channelBookingRef && booking.source !== 'direct') {
        // Cancel via Beds24 API
        const res = await fetch('/api/beds24/bookings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            beds24BookingId: booking.channelBookingRef,
            bookingId: booking.id,
            action: 'cancel',
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '취소에 실패했습니다.');
        }
      } else {
        // Cancel via API
        const res = await fetch('/api/bookings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: booking.id,
            status: 'cancelled',
            cancelledAt: new Date().toISOString(),
          }),
        });
        if (!res.ok) throw new Error('Failed to cancel booking');
      }
      setBookings(prev =>
        prev.map(b => b.id === booking.id ? { ...b, status: 'cancelled' } : b)
      );
    } catch (err) {
      console.error('Failed to cancel booking:', err);
      alert('예약 취소에 실패했습니다.');
    } finally {
      setCancellingId(null);
      setConfirmCancelBooking(null);
    }
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setIsCreating(true);

    try {
      const prop = properties.get(createForm.propertyId);
      if (!prop) throw new Error('숙소를 선택해주세요.');

      if (prop.beds24PropId) {
        // Create via Beds24 API
        const res = await fetch('/api/beds24/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId: createForm.propertyId,
            beds24PropId: prop.beds24PropId,
            firstName: createForm.firstName,
            lastName: createForm.lastName,
            email: createForm.email,
            phone: createForm.phone,
            numAdult: createForm.numAdult,
            numChild: createForm.numChild,
            arrival: createForm.arrival,
            departure: createForm.departure,
            notes: createForm.notes,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '예약 생성에 실패했습니다.');
        }
      } else {
        // Create direct booking via public API
        const res = await fetch('/api/public/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId: createForm.propertyId,
            name: [createForm.firstName, createForm.lastName].filter(Boolean).join(' '),
            email: createForm.email,
            phone: createForm.phone,
            guests: createForm.numAdult + createForm.numChild,
            checkIn: createForm.arrival,
            checkOut: createForm.departure,
            message: createForm.notes,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '예약 생성에 실패했습니다.');
        }
      }

      setIsCreateOpen(false);
      setCreateForm({
        propertyId: '',
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        numAdult: 1,
        numChild: 0,
        arrival: '',
        departure: '',
        notes: '',
      });
      await fetchData();
    } catch (err) {
      setCreateError(String(err instanceof Error ? err.message : err));
    } finally {
      setIsCreating(false);
    }
  };

  const filteredBookings = useMemo(() => {
    return bookings.filter(b => {
      const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
      const matchesProperty = propertyFilter === 'all' || b.propertyId === propertyFilter;
      const matchesSource =
        sourceFilter === 'all' ||
        (sourceFilter === 'direct' && b.source === 'direct') ||
        (sourceFilter === 'ota' && b.source !== 'direct');
      return matchesStatus && matchesProperty && matchesSource;
    });
  }, [bookings, statusFilter, propertyFilter, sourceFilter]);

  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [statusFilter, sourceFilter, propertyFilter]);

  const visibleBookings = useMemo(
    () => filteredBookings.slice(0, visibleCount),
    [filteredBookings, visibleCount],
  );
  const hasMore = visibleCount < filteredBookings.length;

  useEffect(() => {
    if (!hasMore) return;
    const node = loadMoreRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount(c => Math.min(c + PAGE_SIZE, filteredBookings.length));
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, filteredBookings.length]);

  const statusLabel: Record<Booking['status'], string> = {
    confirmed: '확정',
    cancelled: '취소됨',
    pending: '대기 중',
  };

  const statusBadgeClass: Record<Booking['status'], string> = {
    confirmed: 'bg-emerald-500/15 text-emerald-300',
    cancelled: 'bg-white/[0.06] text-white/40',
    pending: 'bg-amber-500/15 text-amber-300',
  };

  const StatusIcon = ({ status }: { status: Booking['status'] }) => {
    if (status === 'confirmed') return <CheckCircle2 size={11} />;
    if (status === 'cancelled') return <X size={11} />;
    return <Clock size={11} />;
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
      return format(parseISO(dateStr), 'yyyy.MM.dd', { locale: ko });
    } catch {
      return dateStr;
    }
  };

  const formatCreatedAt = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
      return format(parseISO(dateStr), 'MM.dd HH:mm');
    } catch {
      return '-';
    }
  };

  const getNights = (checkIn: string, checkOut: string) => {
    if (!checkIn || !checkOut) return 0;
    try {
      return differenceInDays(parseISO(checkOut), parseISO(checkIn));
    } catch {
      return 0;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-white/15 border-t-violet-400 rounded-full animate-spin"></div>
      </div>
    );
  }

  const inputCls = 'w-full bg-black/30 border border-white/[0.08] rounded-xl text-white text-sm px-4 py-3 focus:outline-none focus:border-violet-400/60 transition-colors placeholder:text-white/25';
  const labelCls = 'text-xs text-white/55';

  return (
    <div className="max-w-6xl mx-auto space-y-8 sm:space-y-10">
      <header className="border-b border-white/[0.06] pb-6 sm:pb-7 flex flex-col sm:flex-row gap-4 sm:items-end sm:justify-between">
        <div>
          <p className="text-xs text-violet-300/80 mb-2 font-medium">예약</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">예약 관리</h1>
          <p className="text-white/50 mt-2 text-sm">직접 예약과 OTA 채널 예약을 통합 관리하세요.</p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold rounded-full active:scale-[0.98] transition-colors shrink-0"
        >
          <Plus size={15} />
          새 예약
        </button>
      </header>

      <div className="space-y-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          <Filter size={14} className="text-white/35 mr-1 shrink-0" />
          {(['all', 'confirmed', 'cancelled'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 text-xs transition-colors shrink-0 rounded-full ${
                statusFilter === s
                  ? 'bg-violet-500 text-white font-semibold'
                  : 'bg-white/[0.04] text-white/55 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              {s === 'all' ? '전체' : s === 'confirmed' ? '확정' : '취소됨'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {(['all', 'direct', 'ota'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`px-3 py-1.5 text-xs transition-colors rounded-full ${
                sourceFilter === s
                  ? 'bg-white/[0.08] text-white font-medium'
                  : 'text-white/45 hover:text-white/70'
              }`}
            >
              {s === 'all' ? '전체 소스' : s === 'direct' ? '직접' : 'OTA'}
            </button>
          ))}

          {properties.size > 0 && (
            <div className="relative">
              <select
                value={propertyFilter}
                onChange={e => setPropertyFilter(e.target.value)}
                className="appearance-none bg-white/[0.04] border border-white/[0.08] text-white/80 text-xs px-4 py-2 pr-8 rounded-full focus:outline-none focus:border-violet-400/60 transition-colors cursor-pointer"
              >
                <option value="all">전체 숙소</option>
                {Array.from(properties.entries()).map(([id, prop]) => (
                  <option key={id} value={id}>{prop.name}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/45">
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                  <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>

      {filteredBookings.length === 0 ? (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl py-20 flex flex-col items-center justify-center text-center">
          <BookOpen size={28} strokeWidth={1.5} className="text-white/20 mb-4" />
          <p className="text-white/50 text-sm mb-1">예약 내역이 없습니다.</p>
          <p className="text-white/30 text-xs">
            {statusFilter !== 'all' || sourceFilter !== 'all'
              ? '다른 필터를 선택해보세요.'
              : '예약이 접수되면 여기에 표시됩니다.'}
          </p>
        </div>
      ) : (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="hidden lg:grid grid-cols-[2fr_2fr_1.5fr_1fr_1fr_1fr_1fr_auto] gap-4 px-6 py-3.5 border-b border-white/[0.06]">
            <span className="text-xs text-white/45">숙소 / 게스트</span>
            <span className="text-xs text-white/45">체크인 → 체크아웃</span>
            <span className="text-xs text-white/45">이메일</span>
            <span className="text-xs text-white/45">인원</span>
            <span className="text-xs text-white/45">채널</span>
            <span className="text-xs text-white/45">상태</span>
            <span className="text-xs text-white/45">등록일</span>
            <span></span>
          </div>

          <div className="divide-y divide-white/[0.05]">
            {visibleBookings.map(booking => {
              const nights = getNights(booking.checkIn, booking.checkOut);
              const isCancelling = cancellingId === booking.id;

              return (
                <div
                  key={`${booking.dataSource}-${booking.id}`}
                  className={`px-5 sm:px-6 py-4 transition-colors hover:bg-white/[0.02] ${
                    booking.status === 'cancelled' ? 'opacity-50' : ''
                  }`}
                >
                  {/* Mobile */}
                  <div className="lg:hidden flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-white/55 mb-0.5">{booking.propertyName}</p>
                        <p className="text-base text-white truncate font-medium">{booking.name}</p>
                        {booking.email && <p className="text-xs text-white/45 mt-0.5 truncate">{booking.email}</p>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md border ${getSourceBadgeClass(booking.source)}`}>
                          {getSourceLabel(booking.source)}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md whitespace-nowrap ${statusBadgeClass[booking.status]}`}>
                          <StatusIcon status={booking.status} />
                          {statusLabel[booking.status]}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-sm text-white/65">
                      <span>
                        {formatDate(booking.checkIn)} → {formatDate(booking.checkOut)}
                        {nights > 0 && <span className="text-white/35 ml-1.5">{nights}박</span>}
                      </span>
                      <span className="text-white/25">·</span>
                      <span>{booking.guests}명</span>
                    </div>

                    {booking.status === 'confirmed' && (
                      <div className="flex justify-end">
                        <button
                          onClick={() => setConfirmCancelBooking(booking)}
                          disabled={isCancelling}
                          className="flex items-center gap-1.5 text-xs text-white/55 hover:text-rose-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-30 active:scale-[0.98]"
                        >
                          <X size={12} />
                          취소
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Desktop */}
                  <div className="hidden lg:grid grid-cols-[2fr_2fr_1.5fr_1fr_1fr_1fr_1fr_auto] gap-4 items-center">
                    <div>
                      <p className="text-xs text-white/55 mb-0.5">{booking.propertyName}</p>
                      <p className="text-sm text-white font-medium">{booking.name}</p>
                    </div>

                    <div>
                      <p className="text-sm text-white/80">
                        {formatDate(booking.checkIn)}
                        <span className="text-white/30 mx-1.5">→</span>
                        {formatDate(booking.checkOut)}
                      </p>
                      {nights > 0 && (
                        <p className="text-xs text-white/35 mt-0.5">{nights}박</p>
                      )}
                    </div>

                    <p className="text-sm text-white/55 truncate">{booking.email || '-'}</p>

                    <p className="text-sm text-white/75">{booking.guests}명</p>

                    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md w-fit border ${getSourceBadgeClass(booking.source)}`}>
                      {getSourceLabel(booking.source)}
                    </span>

                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md w-fit ${statusBadgeClass[booking.status]}`}>
                      <StatusIcon status={booking.status} />
                      {statusLabel[booking.status]}
                    </span>

                    <p className="text-xs text-white/40">{formatCreatedAt(booking.createdAt)}</p>

                    <div className="flex justify-end w-16">
                      {booking.status === 'confirmed' && booking.dataSource === 'bookings' && (
                        <button
                          onClick={() => setConfirmCancelBooking(booking)}
                          disabled={isCancelling}
                          className="flex items-center gap-1 text-xs text-white/55 hover:text-rose-400 px-2 py-1 rounded-md transition-colors disabled:opacity-30"
                        >
                          <X size={11} />
                          취소
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div ref={loadMoreRef} className="flex items-center justify-center py-5 border-t border-white/[0.05]">
              <Loader2 size={14} className="animate-spin text-violet-400" />
            </div>
          )}

          <div className="px-6 py-3 border-t border-white/[0.05]">
            <p className="text-xs text-white/35">
              {visibleBookings.length} / {filteredBookings.length}건
              {statusFilter !== 'all' && ` · ${statusFilter === 'confirmed' ? '확정' : '취소됨'} 필터`}
              {sourceFilter !== 'all' && ` · ${sourceFilter === 'direct' ? '직접 예약' : 'OTA'} 필터`}
            </p>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {confirmCancelBooking && (
        <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 backdrop-blur-sm">
          <div className="bg-[#141416] border border-white/[0.08] p-6 sm:p-8 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl">
            <h2 className="text-lg font-semibold text-white mb-2">예약을 취소하시겠습니까?</h2>
            <p className="text-white/60 text-sm mb-2">
              이 작업은 되돌릴 수 없습니다. 예약 상태가 &apos;취소됨&apos;으로 변경됩니다.
            </p>
            {confirmCancelBooking.source !== 'direct' && confirmCancelBooking.channelBookingRef && (
              <p className="text-amber-300 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mt-4">
                Beds24를 통해 OTA 채널에도 취소가 반영됩니다.
              </p>
            )}
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setConfirmCancelBooking(null)}
                disabled={cancellingId === confirmCancelBooking.id}
                className="px-5 py-2.5 text-white/65 hover:text-white text-sm font-medium transition-colors disabled:opacity-30"
              >
                돌아가기
              </button>
              <button
                onClick={() => handleCancelBooking(confirmCancelBooking)}
                disabled={cancellingId === confirmCancelBooking.id}
                className="px-5 py-2.5 bg-rose-500 hover:bg-rose-400 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {cancellingId === confirmCancelBooking.id ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    처리 중...
                  </>
                ) : (
                  '예약 취소 확인'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Booking Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 backdrop-blur-sm">
          <div className="bg-[#141416] border border-white/[0.08] p-6 sm:p-8 w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white">새 예약</h2>
              <button
                onClick={() => { setIsCreateOpen(false); setCreateError(''); }}
                className="text-white/45 hover:text-white transition-colors p-1"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateBooking} className="space-y-5">
              <div className="space-y-2">
                <label className={labelCls}>숙소</label>
                <select
                  required
                  value={createForm.propertyId}
                  onChange={e => setCreateForm(f => ({ ...f, propertyId: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">숙소를 선택하세요</option>
                  {Array.from(properties.entries()).map(([id, prop]) => (
                    <option key={id} value={id}>
                      {prop.name}{prop.beds24PropId ? '' : ' (직접 예약)'}
                    </option>
                  ))}
                </select>
                {createForm.propertyId && properties.get(createForm.propertyId)?.beds24PropId && (
                  <p className="text-xs text-emerald-300">Beds24를 통해 OTA 채널에 동기화됩니다.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className={labelCls}>체크인</label>
                  <input
                    type="date"
                    required
                    value={createForm.arrival}
                    onChange={e => setCreateForm(f => ({ ...f, arrival: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div className="space-y-2">
                  <label className={labelCls}>체크아웃</label>
                  <input
                    type="date"
                    required
                    value={createForm.departure}
                    min={createForm.arrival || undefined}
                    onChange={e => setCreateForm(f => ({ ...f, departure: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className={labelCls}>성</label>
                  <input
                    type="text"
                    required
                    value={createForm.firstName}
                    onChange={e => setCreateForm(f => ({ ...f, firstName: e.target.value }))}
                    placeholder="홍"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-2">
                  <label className={labelCls}>이름</label>
                  <input
                    type="text"
                    value={createForm.lastName}
                    onChange={e => setCreateForm(f => ({ ...f, lastName: e.target.value }))}
                    placeholder="길동"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className={labelCls}>이메일</label>
                  <input
                    type="email"
                    value={createForm.email}
                    onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="guest@email.com"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-2">
                  <label className={labelCls}>전화번호</label>
                  <input
                    type="tel"
                    value={createForm.phone}
                    onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="010-0000-0000"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className={labelCls}>성인</label>
                  <input
                    type="number"
                    min={1}
                    value={createForm.numAdult}
                    onChange={e => setCreateForm(f => ({ ...f, numAdult: Number(e.target.value) || 1 }))}
                    className={inputCls}
                  />
                </div>
                <div className="space-y-2">
                  <label className={labelCls}>아동</label>
                  <input
                    type="number"
                    min={0}
                    value={createForm.numChild}
                    onChange={e => setCreateForm(f => ({ ...f, numChild: Number(e.target.value) || 0 }))}
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className={labelCls}>메모</label>
                <textarea
                  value={createForm.notes}
                  onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  placeholder="특이사항이나 요청사항을 입력하세요."
                  className={`${inputCls} resize-none`}
                />
              </div>

              {createError && (
                <p className="text-rose-300 text-xs bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                  {createError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setIsCreateOpen(false); setCreateError(''); }}
                  disabled={isCreating}
                  className="px-5 py-2.5 text-white/65 hover:text-white text-sm font-medium transition-colors disabled:opacity-30"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-5 py-2.5 bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      생성 중...
                    </>
                  ) : (
                    '예약 생성'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
