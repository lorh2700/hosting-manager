'use client';

import { useState, useEffect, useMemo } from 'react';
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

function getSourceBadgeClass(source: string): string {
  if (source === 'direct' || !source) return 'bg-blue-500/15 text-blue-400 border-blue-500/25';
  if (source.includes('Airbnb') || source.includes('airbnb')) return 'bg-rose-500/15 text-rose-400 border-rose-500/25';
  if (source.includes('Booking') || source.includes('booking')) return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25';
  return 'bg-purple-500/15 text-purple-400 border-purple-500/25';
}

export default function BookingsPage() {
  const { user, profile } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [properties, setProperties] = useState<Map<string, PropertyInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
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

  const statusLabel: Record<Booking['status'], string> = {
    confirmed: '확정',
    cancelled: '취소됨',
    pending: '대기 중',
  };

  const statusBadgeClass: Record<Booking['status'], string> = {
    confirmed: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
    cancelled: 'bg-white/5 text-white/30 border border-white/10',
    pending: 'bg-amber-500/15 text-amber-400 border border-amber-500/25',
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
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 sm:space-y-12">
      {/* Header */}
      <header className="border-b border-white/10 pb-6 sm:pb-8 flex flex-col sm:flex-row gap-4 sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-white/50 mb-3 sm:mb-4">예약</p>
          <h1 className="text-2xl sm:text-4xl font-light tracking-tight text-white">예약 관리</h1>
          <p className="text-white/50 mt-2 sm:mt-4 text-sm font-light tracking-wide">
            직접 예약과 OTA 채널 예약을 통합 관리하세요.
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-white text-black text-[11px] tracking-widest font-semibold hover:bg-white/90 active:scale-[0.98] transition-all shrink-0"
        >
          <Plus size={14} />
          새 예약
        </button>
      </header>

      {/* Filter Bar */}
      <div className="space-y-3">
        {/* Status pill filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          <Filter size={14} className="text-white/30 mr-1 shrink-0" />
          {(['all', 'confirmed', 'cancelled'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 text-xs tracking-widest uppercase transition-colors shrink-0 rounded-lg ${
                statusFilter === s
                  ? 'bg-white text-black font-semibold'
                  : 'border border-white/20 text-white/50 hover:text-white hover:border-white/40'
              }`}
            >
              {s === 'all' ? '전체' : s === 'confirmed' ? '확정' : '취소됨'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Source filter */}
          {(['all', 'direct', 'ota'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`px-3 py-2 text-xs tracking-widest uppercase transition-colors rounded-lg ${
                sourceFilter === s
                  ? 'bg-white/10 text-white border border-white/30 font-semibold'
                  : 'border border-white/10 text-white/40 hover:text-white/60 hover:border-white/20'
              }`}
            >
              {s === 'all' ? '전체 소스' : s === 'direct' ? '직접' : 'OTA'}
            </button>
          ))}

          {/* Property dropdown */}
          {properties.size > 0 && (
            <div className="relative">
              <select
                value={propertyFilter}
                onChange={e => setPropertyFilter(e.target.value)}
                className="appearance-none bg-[#111] border border-white/20 text-white/70 text-xs tracking-widest px-4 py-2 pr-8 rounded-lg focus:outline-none focus:border-white/40 transition-colors cursor-pointer hover:border-white/30"
              >
                <option value="all">전체 숙소</option>
                {Array.from(properties.entries()).map(([id, prop]) => (
                  <option key={id} value={id}>{prop.name}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/40">
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                  <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bookings List */}
      {filteredBookings.length === 0 ? (
        <div className="bg-[#111] border border-white/10 py-24 flex flex-col items-center justify-center text-center">
          <BookOpen size={32} strokeWidth={1} className="text-white/20 mb-5" />
          <p className="text-white/40 text-sm font-light tracking-wide mb-2">예약 내역이 없습니다.</p>
          <p className="text-white/25 text-[11px] tracking-widest">
            {statusFilter !== 'all' || sourceFilter !== 'all'
              ? '다른 필터를 선택해보세요.'
              : '예약이 접수되면 여기에 표시됩니다.'}
          </p>
        </div>
      ) : (
        <div className="bg-[#111] border border-white/10 overflow-hidden">
          {/* Table header */}
          <div className="hidden lg:grid grid-cols-[2fr_2fr_1.5fr_1fr_1fr_1fr_1fr_auto] gap-4 px-6 py-4 border-b border-white/10">
            <span className="text-[10px] uppercase tracking-widest text-white/40">숙소 / 게스트</span>
            <span className="text-[10px] uppercase tracking-widest text-white/40">체크인 → 체크아웃</span>
            <span className="text-[10px] uppercase tracking-widest text-white/40">이메일</span>
            <span className="text-[10px] uppercase tracking-widest text-white/40">인원</span>
            <span className="text-[10px] uppercase tracking-widest text-white/40">채널</span>
            <span className="text-[10px] uppercase tracking-widest text-white/40">상태</span>
            <span className="text-[10px] uppercase tracking-widest text-white/40">등록일</span>
            <span className="text-[10px] uppercase tracking-widest text-white/40"></span>
          </div>

          <div className="divide-y divide-white/5">
            {filteredBookings.map(booking => {
              const nights = getNights(booking.checkIn, booking.checkOut);
              const isCancelling = cancellingId === booking.id;

              return (
                <div
                  key={`${booking.dataSource}-${booking.id}`}
                  className={`px-6 py-5 transition-colors hover:bg-white/[0.02] ${
                    booking.status === 'cancelled' ? 'opacity-50' : ''
                  }`}
                >
                  {/* Mobile layout */}
                  <div className="lg:hidden flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] uppercase tracking-widest text-white/40 mb-1">
                          {booking.propertyName}
                        </p>
                        <p className="text-base font-light text-white truncate">{booking.name}</p>
                        {booking.email && <p className="text-xs text-white/40 mt-0.5 truncate">{booking.email}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`inline-flex items-center px-2 py-1 text-[10px] uppercase tracking-widest font-medium rounded-full border ${getSourceBadgeClass(booking.source)}`}>
                          {getSourceLabel(booking.source)}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-[10px] uppercase tracking-widest font-medium rounded-full whitespace-nowrap ${statusBadgeClass[booking.status]}`}>
                          <StatusIcon status={booking.status} />
                          {statusLabel[booking.status]}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-white/60">
                      <span>
                        {formatDate(booking.checkIn)} → {formatDate(booking.checkOut)}
                        {nights > 0 && <span className="text-white/30 ml-1.5">{nights}박</span>}
                      </span>
                      <span className="text-white/30">·</span>
                      <span>{booking.guests}명</span>
                    </div>

                    {booking.status === 'confirmed' && (
                      <div className="flex justify-end pt-1">
                        <button
                          onClick={() => setConfirmCancelBooking(booking)}
                          disabled={isCancelling}
                          className="flex items-center gap-1.5 text-xs tracking-widest text-white/40 hover:text-red-400 border border-white/10 hover:border-red-400/30 px-4 py-2.5 rounded-lg transition-colors disabled:opacity-30 active:scale-[0.98]"
                        >
                          <X size={12} />
                          취소
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Desktop layout */}
                  <div className="hidden lg:grid grid-cols-[2fr_2fr_1.5fr_1fr_1fr_1fr_1fr_auto] gap-4 items-center">
                    {/* Property / Guest */}
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-white/40 mb-0.5">
                        {booking.propertyName}
                      </p>
                      <p className="text-sm font-light text-white">{booking.name}</p>
                    </div>

                    {/* Dates */}
                    <div>
                      <p className="text-sm text-white/70 font-light">
                        {formatDate(booking.checkIn)}
                        <span className="text-white/30 mx-1.5">→</span>
                        {formatDate(booking.checkOut)}
                      </p>
                      {nights > 0 && (
                        <p className="text-[11px] text-white/30 mt-0.5">{nights}박</p>
                      )}
                    </div>

                    {/* Email */}
                    <p className="text-sm text-white/50 font-light truncate">{booking.email || '-'}</p>

                    {/* Guests */}
                    <p className="text-sm text-white/70 font-light">{booking.guests}명</p>

                    {/* Channel/Source */}
                    <span className={`inline-flex items-center px-2.5 py-1 text-[10px] uppercase tracking-widest font-medium rounded-full w-fit border ${getSourceBadgeClass(booking.source)}`}>
                      {getSourceLabel(booking.source)}
                    </span>

                    {/* Status */}
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-widest font-medium rounded-full w-fit ${statusBadgeClass[booking.status]}`}>
                      <StatusIcon status={booking.status} />
                      {statusLabel[booking.status]}
                    </span>

                    {/* Created */}
                    <p className="text-xs text-white/30 font-light">{formatCreatedAt(booking.createdAt)}</p>

                    {/* Cancel button */}
                    <div className="flex justify-end w-16">
                      {booking.status === 'confirmed' && booking.dataSource === 'bookings' && (
                        <button
                          onClick={() => setConfirmCancelBooking(booking)}
                          disabled={isCancelling}
                          className="flex items-center gap-1 text-[11px] tracking-widest text-white/40 hover:text-red-400 border border-white/10 hover:border-red-400/30 px-3 py-1.5 transition-colors disabled:opacity-30"
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

          {/* Footer count */}
          <div className="px-6 py-4 border-t border-white/5">
            <p className="text-[10px] tracking-widest text-white/25">
              총 {filteredBookings.length}건
              {statusFilter !== 'all' && ` · ${statusFilter === 'confirmed' ? '확정' : '취소됨'} 필터`}
              {sourceFilter !== 'all' && ` · ${sourceFilter === 'direct' ? '직접 예약' : 'OTA'} 필터`}
            </p>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {confirmCancelBooking && (
        <div className="fixed inset-0 bg-[#050505]/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 backdrop-blur-sm">
          <div className="bg-[#111] border border-white/10 p-6 sm:p-10 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl">
            <h2 className="text-xl font-light tracking-wide text-white mb-3">예약을 취소하시겠습니까?</h2>
            <p className="text-white/50 text-sm font-light tracking-wide mb-2">
              이 작업은 되돌릴 수 없습니다. 예약 상태가 &apos;취소됨&apos;으로 변경됩니다.
            </p>
            {confirmCancelBooking.source !== 'direct' && confirmCancelBooking.channelBookingRef && (
              <p className="text-amber-400/80 text-xs font-light tracking-wide mb-6 border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                Beds24를 통해 OTA 채널에도 취소가 반영됩니다.
              </p>
            )}
            <div className="flex justify-end gap-4 mt-8">
              <button
                onClick={() => setConfirmCancelBooking(null)}
                disabled={cancellingId === confirmCancelBooking.id}
                className="px-6 py-3 text-white/50 hover:text-white text-[11px] tracking-widest font-semibold transition-colors disabled:opacity-30"
              >
                돌아가기
              </button>
              <button
                onClick={() => handleCancelBooking(confirmCancelBooking)}
                disabled={cancellingId === confirmCancelBooking.id}
                className="px-6 py-3 bg-white text-black text-[11px] tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {cancellingId === confirmCancelBooking.id ? (
                  <>
                    <div className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
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
        <div className="fixed inset-0 bg-[#050505]/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 backdrop-blur-sm">
          <div className="bg-[#111] border border-white/10 p-6 sm:p-10 w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-light tracking-wide text-white">새 예약</h2>
              <button
                onClick={() => { setIsCreateOpen(false); setCreateError(''); }}
                className="text-white/40 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateBooking} className="space-y-6">
              {/* Property */}
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-white/40">숙소</label>
                <select
                  required
                  value={createForm.propertyId}
                  onChange={e => setCreateForm(f => ({ ...f, propertyId: e.target.value }))}
                  className="w-full bg-black/50 border border-white/10 text-white text-sm px-4 py-3 focus:outline-none focus:border-white/30 transition-colors"
                >
                  <option value="">숙소를 선택하세요</option>
                  {Array.from(properties.entries()).map(([id, prop]) => (
                    <option key={id} value={id}>
                      {prop.name}{prop.beds24PropId ? '' : ' (직접 예약)'}
                    </option>
                  ))}
                </select>
                {createForm.propertyId && properties.get(createForm.propertyId)?.beds24PropId && (
                  <p className="text-[10px] text-emerald-400/70 tracking-wide">Beds24를 통해 OTA 채널에 동기화됩니다.</p>
                )}
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-white/40">체크인</label>
                  <input
                    type="date"
                    required
                    value={createForm.arrival}
                    onChange={e => setCreateForm(f => ({ ...f, arrival: e.target.value }))}
                    className="w-full bg-black/50 border border-white/10 text-white text-sm px-4 py-3 focus:outline-none focus:border-white/30 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-white/40">체크아웃</label>
                  <input
                    type="date"
                    required
                    value={createForm.departure}
                    min={createForm.arrival || undefined}
                    onChange={e => setCreateForm(f => ({ ...f, departure: e.target.value }))}
                    className="w-full bg-black/50 border border-white/10 text-white text-sm px-4 py-3 focus:outline-none focus:border-white/30 transition-colors"
                  />
                </div>
              </div>

              {/* Guest name */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-white/40">성</label>
                  <input
                    type="text"
                    required
                    value={createForm.firstName}
                    onChange={e => setCreateForm(f => ({ ...f, firstName: e.target.value }))}
                    placeholder="홍"
                    className="w-full bg-black/50 border border-white/10 text-white text-sm px-4 py-3 focus:outline-none focus:border-white/30 transition-colors placeholder:text-white/20"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-white/40">이름</label>
                  <input
                    type="text"
                    value={createForm.lastName}
                    onChange={e => setCreateForm(f => ({ ...f, lastName: e.target.value }))}
                    placeholder="길동"
                    className="w-full bg-black/50 border border-white/10 text-white text-sm px-4 py-3 focus:outline-none focus:border-white/30 transition-colors placeholder:text-white/20"
                  />
                </div>
              </div>

              {/* Contact */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-white/40">이메일</label>
                  <input
                    type="email"
                    value={createForm.email}
                    onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="guest@email.com"
                    className="w-full bg-black/50 border border-white/10 text-white text-sm px-4 py-3 focus:outline-none focus:border-white/30 transition-colors placeholder:text-white/20"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-white/40">전화번호</label>
                  <input
                    type="tel"
                    value={createForm.phone}
                    onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="010-0000-0000"
                    className="w-full bg-black/50 border border-white/10 text-white text-sm px-4 py-3 focus:outline-none focus:border-white/30 transition-colors placeholder:text-white/20"
                  />
                </div>
              </div>

              {/* Guests count */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-white/40">성인</label>
                  <input
                    type="number"
                    min={1}
                    value={createForm.numAdult}
                    onChange={e => setCreateForm(f => ({ ...f, numAdult: Number(e.target.value) || 1 }))}
                    className="w-full bg-black/50 border border-white/10 text-white text-sm px-4 py-3 focus:outline-none focus:border-white/30 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-white/40">아동</label>
                  <input
                    type="number"
                    min={0}
                    value={createForm.numChild}
                    onChange={e => setCreateForm(f => ({ ...f, numChild: Number(e.target.value) || 0 }))}
                    className="w-full bg-black/50 border border-white/10 text-white text-sm px-4 py-3 focus:outline-none focus:border-white/30 transition-colors"
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-white/40">메모</label>
                <textarea
                  value={createForm.notes}
                  onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  placeholder="특이사항이나 요청사항을 입력하세요."
                  className="w-full bg-black/50 border border-white/10 text-white text-sm px-4 py-3 focus:outline-none focus:border-white/30 transition-colors placeholder:text-white/20 resize-none"
                />
              </div>

              {/* Error message */}
              {createError && (
                <p className="text-red-400 text-xs font-light tracking-wide border border-red-500/20 bg-red-500/5 px-3 py-2">
                  {createError}
                </p>
              )}

              {/* Submit */}
              <div className="flex justify-end gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => { setIsCreateOpen(false); setCreateError(''); }}
                  disabled={isCreating}
                  className="px-6 py-3 text-white/50 hover:text-white text-[11px] tracking-widest font-semibold transition-colors disabled:opacity-30"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-6 py-3 bg-white text-black text-[11px] tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center gap-2"
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
