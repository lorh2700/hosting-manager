'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, query, getDocs, where, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { BookOpen, X, CheckCircle2, Clock, Filter } from 'lucide-react';

interface Booking {
  id: string;
  propertyId: string;
  propertyName: string;
  name: string;
  email: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  status: 'confirmed' | 'cancelled' | 'pending';
  createdAt: string;
}

type StatusFilter = 'all' | 'confirmed' | 'cancelled';

export default function BookingsPage() {
  const { user, profile } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [properties, setProperties] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [propertyFilter, setPropertyFilter] = useState<string>('all');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const fetchData = async () => {
    if (!user) return;
    try {
      const propsSnapshot = profile?.role === 'super_admin'
        ? await getDocs(collection(db, 'properties'))
        : await getDocs(query(collection(db, 'properties'), where('ownerId', '==', user.uid)));

      const propsMap = new Map<string, string>();
      propsSnapshot.docs.forEach(d => {
        propsMap.set(d.id, d.data().name);
      });
      setProperties(propsMap);

      const propertyIds = Array.from(propsMap.keys());
      if (propertyIds.length === 0) {
        setBookings([]);
        return;
      }

      const bookingsQuery = query(
        collection(db, 'bookings'),
        where('propertyId', 'in', propertyIds.slice(0, 10))
      );
      const bookingsSnapshot = await getDocs(bookingsQuery);

      const rawBookings: Booking[] = bookingsSnapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          propertyId: data.propertyId,
          propertyName: propsMap.get(data.propertyId) ?? '알 수 없는 숙소',
          name: data.name ?? '',
          email: data.email ?? '',
          checkIn: data.checkIn ?? '',
          checkOut: data.checkOut ?? '',
          guests: data.guests ?? 1,
          status: data.status ?? 'pending',
          createdAt: data.createdAt ?? '',
        };
      });

      rawBookings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setBookings(rawBookings);
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const handleCancelBooking = async (bookingId: string) => {
    setCancellingId(bookingId);
    try {
      await updateDoc(doc(db, 'bookings', bookingId), { status: 'cancelled' });
      setBookings(prev =>
        prev.map(b => b.id === bookingId ? { ...b, status: 'cancelled' } : b)
      );
    } catch (err) {
      console.error('Failed to cancel booking:', err);
      alert('예약 취소에 실패했습니다.');
    } finally {
      setCancellingId(null);
      setConfirmCancelId(null);
    }
  };

  const filteredBookings = useMemo(() => {
    return bookings.filter(b => {
      const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
      const matchesProperty = propertyFilter === 'all' || b.propertyId === propertyFilter;
      return matchesStatus && matchesProperty;
    });
  }, [bookings, statusFilter, propertyFilter]);

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
    <div className="max-w-6xl mx-auto space-y-12">
      {/* Header */}
      <header className="border-b border-white/10 pb-8">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-4">예약</p>
        <h1 className="text-4xl font-light tracking-tight text-white">예약 관리</h1>
        <p className="text-white/50 mt-4 text-sm font-light tracking-wide">
          직접 예약 내역을 확인하고 관리하세요.
        </p>
      </header>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        {/* Status pill filters */}
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-white/30 mr-1" />
          {(['all', 'confirmed', 'cancelled'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-1.5 text-[11px] tracking-widest uppercase transition-colors ${
                statusFilter === s
                  ? 'bg-white text-black font-semibold'
                  : 'border border-white/20 text-white/50 hover:text-white hover:border-white/40'
              }`}
            >
              {s === 'all' ? '전체' : s === 'confirmed' ? '확정' : '취소됨'}
            </button>
          ))}
        </div>

        {/* Property dropdown */}
        {properties.size > 0 && (
          <div className="relative">
            <select
              value={propertyFilter}
              onChange={e => setPropertyFilter(e.target.value)}
              className="appearance-none bg-[#111] border border-white/20 text-white/70 text-[11px] tracking-widest px-4 py-2 pr-8 focus:outline-none focus:border-white/40 transition-colors cursor-pointer hover:border-white/30"
            >
              <option value="all">전체 숙소</option>
              {Array.from(properties.entries()).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
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

      {/* Bookings List */}
      {filteredBookings.length === 0 ? (
        <div className="bg-[#111] border border-white/10 py-24 flex flex-col items-center justify-center text-center">
          <BookOpen size={32} strokeWidth={1} className="text-white/20 mb-5" />
          <p className="text-white/40 text-sm font-light tracking-wide mb-2">예약 내역이 없습니다.</p>
          <p className="text-white/25 text-[11px] tracking-widest">
            {statusFilter !== 'all'
              ? '다른 필터를 선택해보세요.'
              : '직접 예약이 접수되면 여기에 표시됩니다.'}
          </p>
        </div>
      ) : (
        <div className="bg-[#111] border border-white/10 overflow-hidden">
          {/* Table header */}
          <div className="hidden lg:grid grid-cols-[2fr_2fr_2fr_1fr_1fr_1fr_auto] gap-4 px-6 py-4 border-b border-white/10">
            <span className="text-[10px] uppercase tracking-widest text-white/40">숙소 / 게스트</span>
            <span className="text-[10px] uppercase tracking-widest text-white/40">체크인 → 체크아웃</span>
            <span className="text-[10px] uppercase tracking-widest text-white/40">이메일</span>
            <span className="text-[10px] uppercase tracking-widest text-white/40">인원</span>
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
                  key={booking.id}
                  className={`px-6 py-5 transition-colors hover:bg-white/[0.02] ${
                    booking.status === 'cancelled' ? 'opacity-50' : ''
                  }`}
                >
                  {/* Mobile layout */}
                  <div className="lg:hidden flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">
                          {booking.propertyName}
                        </p>
                        <p className="text-base font-light text-white">{booking.name}</p>
                        <p className="text-xs text-white/40 mt-0.5">{booking.email}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-widest font-medium rounded-full whitespace-nowrap ${statusBadgeClass[booking.status]}`}>
                        <StatusIcon status={booking.status} />
                        {statusLabel[booking.status]}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">체크인 → 체크아웃</p>
                        <p className="text-sm text-white/70 font-light">
                          {formatDate(booking.checkIn)} → {formatDate(booking.checkOut)}
                          {nights > 0 && (
                            <span className="text-white/30 ml-2 text-xs">{nights}박</span>
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">인원</p>
                        <p className="text-sm text-white/70 font-light">{booking.guests}명</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">등록일</p>
                        <p className="text-sm text-white/40 font-light">{formatCreatedAt(booking.createdAt)}</p>
                      </div>
                    </div>

                    {booking.status === 'confirmed' && (
                      <div className="flex justify-end">
                        <button
                          onClick={() => setConfirmCancelId(booking.id)}
                          disabled={isCancelling}
                          className="flex items-center gap-1.5 text-[11px] tracking-widest text-white/40 hover:text-red-400 border border-white/10 hover:border-red-400/30 px-4 py-2 transition-colors disabled:opacity-30"
                        >
                          <X size={12} />
                          취소
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Desktop layout */}
                  <div className="hidden lg:grid grid-cols-[2fr_2fr_2fr_1fr_1fr_1fr_auto] gap-4 items-center">
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
                    <p className="text-sm text-white/50 font-light truncate">{booking.email}</p>

                    {/* Guests */}
                    <p className="text-sm text-white/70 font-light">{booking.guests}명</p>

                    {/* Status */}
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-widest font-medium rounded-full w-fit ${statusBadgeClass[booking.status]}`}>
                      <StatusIcon status={booking.status} />
                      {statusLabel[booking.status]}
                    </span>

                    {/* Created */}
                    <p className="text-xs text-white/30 font-light">{formatCreatedAt(booking.createdAt)}</p>

                    {/* Cancel button */}
                    <div className="flex justify-end w-16">
                      {booking.status === 'confirmed' && (
                        <button
                          onClick={() => setConfirmCancelId(booking.id)}
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
              {statusFilter !== 'all' && ` · ${statusFilter === 'confirmed' ? '확정' : '취소됨'} 필터 적용 중`}
            </p>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {confirmCancelId && (
        <div className="fixed inset-0 bg-[#050505]/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-[#111] border border-white/10 p-10 w-full max-w-md">
            <h2 className="text-xl font-light tracking-wide text-white mb-3">예약을 취소하시겠습니까?</h2>
            <p className="text-white/50 text-sm font-light tracking-wide mb-8">
              이 작업은 되돌릴 수 없습니다. 예약 상태가 '취소됨'으로 변경됩니다.
            </p>
            <div className="flex justify-end gap-4">
              <button
                onClick={() => setConfirmCancelId(null)}
                disabled={cancellingId === confirmCancelId}
                className="px-6 py-3 text-white/50 hover:text-white text-[11px] tracking-widest font-semibold transition-colors disabled:opacity-30"
              >
                돌아가기
              </button>
              <button
                onClick={() => handleCancelBooking(confirmCancelId)}
                disabled={cancellingId === confirmCancelId}
                className="px-6 py-3 bg-white text-black text-[11px] tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {cancellingId === confirmCancelId ? (
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
    </div>
  );
}
