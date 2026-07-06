'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ArrowRight, Clock, Users as UsersIcon, X } from 'lucide-react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isBefore, startOfToday, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { PropertyData } from '@/lib/types';

export default function BookPage() {
  const { id } = useParams() as { id: string };
  const [property, setProperty] = useState<PropertyData | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentMonth, setCurrentMonth] = useState(startOfToday());
  const [checkIn, setCheckIn] = useState<Date | null>(null);
  const [checkOut, setCheckOut] = useState<Date | null>(null);

  const [guests, setGuests] = useState(2);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [heroIndex, setHeroIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchPropertyAndBookings = async () => {
      try {
        const res = await fetch(`/api/public/properties/${id}`);
        if (res.ok) {
          const data = await res.json();
          setProperty({
            id: data.id,
            name: data.name,
            timezone: data.timezone,
            permit: data.permit ?? null,
            imageUrl: data.imageUrl ?? null,
            images: data.images ?? [],
            description: data.description ?? null,
            checkInTime: data.checkInTime ?? null,
            checkOutTime: data.checkOutTime ?? null,
            maxGuests: data.maxGuests ?? null,
            region: data.region ?? null,
            slug: data.slug ?? null,
            status: data.status ?? 'active',
            openingDate: data.openingDate ?? null,
            addressKo: data.addressKo ?? null,
            catchphrase: data.catchphrase ?? null,
            bookedDates: data.bookedDates ?? [],
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchPropertyAndBookings();
  }, [id]);

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  // 날짜가 예약 범위 안에 있는지 (체크인용: 시작일 포함)
  const isDateBooked = (date: Date) => {
    if (!property) return false;
    return property.bookedDates.some(b => {
      const start = parseISO(b.start);
      const end = parseISO(b.end);
      return date >= start && date < end;
    });
  };

  // 체크아웃으로 선택 가능한지 (예약 시작일은 체크아웃 가능 — 오전퇴실/오후입실)
  const isDateBookedMiddle = (date: Date) => {
    if (!property) return false;
    return property.bookedDates.some(b => {
      const start = parseISO(b.start);
      const end = parseISO(b.end);
      return date > start && date < end; // 시작일 제외
    });
  };

  // 체크아웃 선택 중인지
  const isSelectingCheckout = checkIn && !checkOut;

  const handleDateClick = (date: Date) => {
    if (isBefore(date, startOfToday())) return;

    if (!checkIn || (checkIn && checkOut)) {
      // 체크인 선택: 예약된 날은 불가
      if (isDateBooked(date)) return;
      setCheckIn(date);
      setCheckOut(null);
    } else if (checkIn && !checkOut) {
      if (isBefore(date, checkIn) || isSameDay(date, checkIn)) {
        // 같은 날 또는 이전 날 → 체크인 재설정 (최소 1박)
        if (isDateBooked(date)) return;
        setCheckIn(date);
      } else {
        // 체크아웃 선택: 중간에 예약이 끼어있으면 안 됨
        // 단, 선택한 날이 예약 시작일이면 OK (그 날 체크아웃)
        const interval = eachDayOfInterval({ start: checkIn, end: date });
        const hasBlockedMiddle = interval.some(d =>
          !isSameDay(d, checkIn) && !isSameDay(d, date) && isDateBooked(d)
        );

        // 선택한 날 자체가 예약 중간에 있으면 불가 (시작일은 OK)
        if (hasBlockedMiddle || isDateBookedMiddle(date)) {
          if (!isDateBooked(date)) {
            setCheckIn(date);
          }
        } else {
          setCheckOut(date);
          setTimeout(() => {
            formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 300);
        }
      }
    }
  };

  const isDateSelected = (date: Date) => {
    if (checkIn && isSameDay(date, checkIn)) return true;
    if (checkOut && isSameDay(date, checkOut)) return true;
    if (checkIn && checkOut && date > checkIn && date < checkOut) return true;
    return false;
  };

  const isDateInRange = (date: Date) => {
    if (checkIn && checkOut && date > checkIn && date < checkOut) return true;
    return false;
  };

  const maxGuests = property?.maxGuests ?? 10;

  const handleBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkIn || !checkOut || !name || !phone || !email) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/public/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: id,
          propertyName: property?.name || '',
          checkIn: format(checkIn, 'yyyy-MM-dd'),
          checkOut: format(checkOut, 'yyyy-MM-dd'),
          guests,
          name,
          phone,
          email,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '예약 실패');
      }

      setIsSuccess(true);
    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error ? error.message : '예약에 실패했습니다. 다시 시도해주세요.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0C0A09]">
        <div className="w-8 h-8 border-t-2 border-stone-300 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0C0A09] text-stone-50 gap-6">
        <p className="font-serif text-2xl">숙소를 찾을 수 없습니다.</p>
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-50 transition-colors underline underline-offset-4">
          메인으로 돌아가기
        </Link>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0C0A09] text-stone-50 p-8">
        <h1 className="font-serif text-5xl md:text-7xl font-light mb-6 tracking-tight">예약 요청 완료</h1>
        <p className="text-stone-300 text-lg mb-12 font-light tracking-wide">예약 요청이 접수되었습니다. 확인 후 연락드리겠습니다.</p>
        <div className="flex gap-4">
          <Link
            href="/"
            className="px-8 py-4 border border-stone-600 rounded-full text-sm uppercase tracking-widest hover:bg-stone-50 hover:text-stone-900 transition-colors duration-500"
          >
            메인으로
          </Link>
          <button
            onClick={() => setIsSuccess(false)}
            className="px-8 py-4 bg-stone-100 text-stone-900 rounded-full text-sm uppercase tracking-widest hover:bg-stone-200 transition-colors duration-500"
          >
            추가 예약
          </button>
        </div>
      </div>
    );
  }

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const startDayOfWeek = startOfMonth(currentMonth).getDay();
  const emptyDays = Array.from({ length: startDayOfWeek }, (_, i) => i);

  const nightCount = checkIn && checkOut
    ? Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <div className="min-h-screen bg-[#0C0A09] text-stone-50 selection:bg-stone-400/20">
      {/* Top Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center px-6 md:px-8 py-5 mix-blend-difference">
        <Link href="/" className="text-sm uppercase tracking-[0.2em] font-medium hover:opacity-70 transition-opacity">
          void anchae
        </Link>
      </nav>

      {/* Hero Gallery Section */}
      {(() => {
        const galleryImages = property.images && property.images.length > 0
          ? property.images
          : [property.imageUrl || '/images/main_yard.webp'];
        return (
          <div className="relative h-[50vh] md:h-[65vh] w-full overflow-hidden group/hero">
            {galleryImages.map((src, i) => (
              <Image
                key={src}
                src={src}
                alt={`${property.name} ${i + 1}`}
                fill
                className={`object-cover transition-opacity duration-1000 ease-in-out opacity-0 ${i === heroIndex ? 'opacity-40' : ''} mix-blend-luminosity scale-105`}
                priority={i === 0}
              />
            ))}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0C0A09]/50 to-[#0C0A09]"></div>

            {/* Gallery Navigation */}
            {galleryImages.length > 1 && (
              <>
                <button
                  onClick={() => setHeroIndex((heroIndex - 1 + galleryImages.length) % galleryImages.length)}
                  className="absolute left-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-black/30 backdrop-blur-sm border border-stone-800 text-stone-400 hover:text-stone-50 hover:bg-black/50 transition-all opacity-0 group-hover/hero:opacity-100"
                  aria-label="이전 이미지"
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  onClick={() => setHeroIndex((heroIndex + 1) % galleryImages.length)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-black/30 backdrop-blur-sm border border-stone-800 text-stone-400 hover:text-stone-50 hover:bg-black/50 transition-all opacity-0 group-hover/hero:opacity-100"
                  aria-label="다음 이미지"
                >
                  <ChevronRight size={20} />
                </button>
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 flex gap-2">
                  {galleryImages.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setHeroIndex(i)}
                      className={`h-2 rounded-full transition-all duration-300 ${i === heroIndex ? 'bg-stone-100 w-6' : 'bg-stone-100/40 hover:bg-stone-100/60 w-2'}`}
                      aria-label={`이미지 ${i + 1}`}
                    />
                  ))}
                </div>
              </>
            )}

            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center z-20 pointer-events-none">
              <p className="text-xs uppercase tracking-[0.3em] text-stone-400 mb-4 font-semibold">
                {property.region ? `${property.region} · ` : ''}void anchae
              </p>
              <h1 className="font-serif text-5xl md:text-7xl lg:text-[100px] font-light tracking-tighter leading-none mb-6">
                {property.name}
              </h1>
              {property.description && (
                <p className="text-stone-400 text-sm md:text-base font-light max-w-lg leading-relaxed">
                  {property.description}
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Property Info Bar */}
      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-wrap items-center justify-center gap-8 text-sm text-stone-400 border-b border-stone-800">
        {property.checkInTime && (
          <div className="flex items-center gap-2">
            <Clock size={15} className="text-stone-500" />
            <span>체크인 {property.checkInTime}</span>
          </div>
        )}
        {property.checkOutTime && (
          <div className="flex items-center gap-2">
            <Clock size={15} className="text-stone-500" />
            <span>체크아웃 {property.checkOutTime}</span>
          </div>
        )}
        {property.maxGuests && (
          <div className="flex items-center gap-2">
            <UsersIcon size={15} className="text-stone-500" />
            <span>최대 {property.maxGuests}인</span>
          </div>
        )}
      </div>

      {property.status === 'coming_soon' ? (
        /* Coming Soon Panel — 캘린더/폼 대신 오픈 예정 안내 */
        <div className="max-w-2xl mx-auto px-6 py-24 md:py-32 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-amber-400 mb-6 font-semibold">
            Coming Soon
          </p>
          <h2 className="font-serif text-3xl md:text-5xl font-light mb-6 tracking-tight text-stone-100">
            {property.openingDate
              ? `${property.openingDate.replace(/^(\d{4})-(\d{2}).*/, '$2월')} 오픈 예정`
              : '오픈 예정'}
          </h2>
          <p className="text-stone-400 text-base md:text-lg font-light leading-relaxed max-w-lg mx-auto mb-12">
            {property.name} 은 곧 새로운 손님을 맞이할 준비를 하고 있습니다.
            오픈 소식은 홈에서 먼저 안내드리겠습니다.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-3 px-8 py-4 border border-stone-700 rounded-full text-sm uppercase tracking-widest text-stone-300 hover:bg-stone-100 hover:text-stone-900 hover:border-stone-100 transition-colors duration-500"
          >
            메인으로
            <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
      <div className="max-w-5xl mx-auto px-6 py-16 md:py-24 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20">

        {/* Left: Calendar */}
        <div className="lg:col-span-7 space-y-8">
          <div>
            <h2 className="font-serif text-3xl md:text-4xl font-light mb-2">날짜 선택</h2>
            <p className="text-stone-500 text-sm font-light tracking-wide">원하시는 숙박 일정을 선택해주세요.</p>
          </div>

          <div className="bg-stone-900 border border-stone-800 rounded-3xl p-6 md:p-10">
            <div className="flex justify-between items-center mb-8">
              <h3 className="font-serif text-xl md:text-2xl font-light tracking-wide">
                {format(currentMonth, 'yyyy년 M월', { locale: ko })}
              </h3>
              <div className="flex gap-2">
                <button onClick={prevMonth} className="p-3 border border-stone-800 rounded-full hover:bg-stone-800/40 transition-colors" aria-label="이전 달">
                  <ChevronLeft size={18} className="text-stone-300" />
                </button>
                <button onClick={nextMonth} className="p-3 border border-stone-800 rounded-full hover:bg-stone-800/40 transition-colors" aria-label="다음 달">
                  <ChevronRight size={18} className="text-stone-300" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-y-4 gap-x-1 text-center mb-4">
              {['일', '월', '화', '수', '목', '금', '토'].map(day => (
                <div key={day} className="text-xs uppercase tracking-widest text-stone-500 font-medium py-2">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-1.5 gap-x-1 text-center">
              {emptyDays.map(i => (
                <div key={`empty-${i}`} className="h-11"></div>
              ))}
              {daysInMonth.map(date => {
                const isPast = isBefore(date, startOfToday());
                const isBooked = isDateBooked(date);
                const isBookedStart = property?.bookedDates.some(b => isSameDay(date, parseISO(b.start))) ?? false;
                const isSelected = isDateSelected(date);
                const inRange = isDateInRange(date);
                const isStart = checkIn && isSameDay(date, checkIn);
                const isEnd = checkOut && isSameDay(date, checkOut);
                const isOnlyStart = isStart && !checkOut;

                // 체크아웃 선택 중 + 체크인 이후 + 예약 시작일 + 중간에 다른 예약 없는 경우만
                const isAfterCheckIn = checkIn ? date > checkIn : false;
                const hasNoBlockBetween = checkIn && isAfterCheckIn
                  ? !eachDayOfInterval({ start: checkIn, end: date }).some(d =>
                      !isSameDay(d, checkIn) && !isSameDay(d, date) && isDateBooked(d)
                    )
                  : false;
                const canClickForCheckout = isSelectingCheckout && isAfterCheckIn && isBookedStart && !isDateBookedMiddle(date) && hasNoBlockBetween;
                const isDisabled = isPast || (isBooked && !canClickForCheckout);

                return (
                  <button
                    key={date.toString()}
                    onClick={() => handleDateClick(date)}
                    disabled={isDisabled}
                    className={`
                      relative h-11 w-full flex items-center justify-center text-sm transition-all duration-200 rounded-full
                      ${isDisabled
                        ? isBooked && !isPast
                          ? 'bg-stone-800/40 text-stone-700 cursor-not-allowed line-through decoration-stone-600'
                          : 'text-stone-800 cursor-not-allowed'
                        : ''}
                      ${canClickForCheckout && !isSelected
                        ? 'text-stone-500 hover:bg-amber-500/15 hover:text-stone-300 border border-dashed border-stone-700'
                        : ''}
                      ${!isDisabled && !canClickForCheckout && !isSelected && !inRange
                        ? 'text-stone-100 font-light hover:bg-stone-800 hover:text-stone-50'
                        : ''}
                      ${isSelected ? 'text-black font-medium' : ''}
                      ${inRange ? 'bg-stone-800/60 text-stone-50 rounded-none' : ''}
                      ${isOnlyStart ? 'bg-stone-100 rounded-full' : ''}
                      ${isStart && !isOnlyStart ? 'bg-stone-100 rounded-l-full rounded-r-none' : ''}
                      ${isEnd ? 'bg-stone-100 rounded-r-full rounded-l-none' : ''}
                    `}
                    aria-label={`${format(date, 'M월 d일')}${isDisabled ? (isBooked ? ' 예약 완료' : ' 지난 날짜') : canClickForCheckout ? ' 체크아웃 가능' : ' 예약 가능'}`}
                  >
                    <span className="relative z-10">{format(date, 'd')}</span>
                    {isBooked && !isPast && !canClickForCheckout && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-red-400/60"></span>
                    )}
                    {canClickForCheckout && !isSelected && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-amber-400/60"></span>
                    )}
                    {!isPast && !isBooked && !isSelected && !inRange && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-400/50"></span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-6 mt-6 pt-5 border-t border-stone-800/60">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400/50"></span>
                <span className="text-xs text-stone-500 tracking-wide">예약 가능</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-400/60"></span>
                <span className="text-xs text-stone-500 tracking-wide">예약 완료</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-stone-100"></span>
                <span className="text-xs text-stone-500 tracking-wide">선택됨</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Booking Form */}
        <div className="lg:col-span-5" ref={formRef}>
          <div className="sticky top-12 space-y-8">
            <div>
              <h2 className="font-serif text-3xl md:text-4xl font-light mb-2">예약</h2>
              <p className="text-stone-500 text-sm font-light tracking-wide">예약 정보를 입력해주세요.</p>
            </div>

            {/* Error Toast */}
            {errorMessage && (
              <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl px-5 py-4">
                <p className="text-red-300 text-sm flex-1">{errorMessage}</p>
                <button onClick={() => setErrorMessage(null)} className="text-red-300/60 hover:text-red-300 transition-colors" aria-label="닫기">
                  <X size={16} />
                </button>
              </div>
            )}

            <form onSubmit={handleBooking} className="space-y-6">
              {/* Date Summary */}
              <div className="flex items-center justify-between py-5 border-y border-stone-800">
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-widest text-stone-500 mb-1.5">체크인</p>
                  <p className="font-serif text-lg md:text-xl">{checkIn ? format(checkIn, 'MM월 dd일 (eee)', { locale: ko }) : '날짜 선택'}</p>
                </div>
                <div className="flex flex-col items-center mx-3">
                  <ArrowRight size={14} className="text-stone-700" />
                  {nightCount > 0 && (
                    <span className="text-xs text-stone-500 mt-1">{nightCount}박</span>
                  )}
                </div>
                <div className="flex-1 text-right">
                  <p className="text-xs uppercase tracking-widest text-stone-500 mb-1.5">체크아웃</p>
                  <p className="font-serif text-lg md:text-xl">{checkOut ? format(checkOut, 'MM월 dd일 (eee)', { locale: ko }) : '날짜 선택'}</p>
                </div>
              </div>

              {/* Guests */}
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-stone-500">인원</label>
                <div className="flex items-center justify-between border border-stone-700 rounded-full p-2 bg-stone-800/40">
                  <button
                    type="button"
                    onClick={() => setGuests(Math.max(1, guests - 1))}
                    className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-stone-800/60 transition-colors text-xl font-light"
                    aria-label="인원 감소"
                  >-</button>
                  <span className="font-serif text-xl">{guests}</span>
                  <button
                    type="button"
                    onClick={() => setGuests(Math.min(maxGuests, guests + 1))}
                    className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-stone-800/60 transition-colors text-xl font-light"
                    aria-label="인원 증가"
                  >+</button>
                </div>
                {property.maxGuests && (
                  <p className="text-xs text-stone-600 text-right">최대 {property.maxGuests}인</p>
                )}
              </div>

              {/* Guest Info */}
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-widest text-stone-500">이름</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-transparent border-b border-stone-700 py-3 text-stone-50 font-light focus:outline-none focus:border-stone-400 transition-colors placeholder:text-stone-700"
                    placeholder="홍길동"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-widest text-stone-500">연락처</label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-transparent border-b border-stone-700 py-3 text-stone-50 font-light focus:outline-none focus:border-stone-400 transition-colors placeholder:text-stone-700"
                    placeholder="010-1234-5678"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-widest text-stone-500">이메일 주소</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-transparent border-b border-stone-700 py-3 text-stone-50 font-light focus:outline-none focus:border-stone-400 transition-colors placeholder:text-stone-700"
                    placeholder="example@email.com"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={!checkIn || !checkOut || !name || !phone || !email || isSubmitting}
                className={`
                  w-full py-5 rounded-full text-sm uppercase tracking-widest font-medium transition-all duration-500
                  ${checkIn && checkOut && name && phone && email
                    ? 'bg-stone-100 text-stone-900 hover:bg-stone-200 shadow-[0_0_40px_rgba(214,211,209,0.15)]'
                    : 'bg-stone-800/60 text-stone-600 cursor-not-allowed'}
                `}
              >
                {isSubmitting ? '처리 중...' : '예약 요청하기'}
              </button>

              {!checkIn && (
                <p className="text-center text-xs text-stone-600">먼저 캘린더에서 체크인 날짜를 선택해주세요</p>
              )}
              {checkIn && !checkOut && (
                <p className="text-center text-xs text-stone-600">체크아웃 날짜를 선택해주세요</p>
              )}
            </form>
          </div>
        </div>
      </div>
      )}

      {/* Legal Footer */}
      {property.permit && (
        <div className="border-t border-stone-800 py-8 px-6 text-center">
          <p className="text-xs text-stone-600 tracking-widest font-light">
            {property.permit}
          </p>
        </div>
      )}
    </div>
  );
}
