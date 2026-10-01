'use client';

import { usePublicLanguage } from '@/components/PublicLanguage';

import { useState, useEffect, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { parseStaySearch } from '@/lib/stay-search';
import { BookingPhotoGallery } from '@/components/BookingPhotoGallery';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ArrowRight, Clock, Users as UsersIcon, X } from 'lucide-react';
import { format, addDays, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isBefore } from 'date-fns';
import { ko, enUS } from 'date-fns/locale';
import type { PropertyData } from '@/lib/types';
import type { StayOptions } from '@/lib/payments/stay-options';
import { BASE_GUESTS } from '@/lib/payments/stay-options';
import { todayKst } from '@/lib/dates';
import { arrivalIssue, stayIssue, type StayCalendar } from '@/lib/stay-calendar';

export default function BookPage() {
  const { id } = useParams() as { id: string };
  return <Suspense fallback={<div className="min-h-screen bg-stone-950" />}><BookingContent key={id} /></Suspense>;
}

function BookingContent() {
  const query = useSearchParams();
  const initial = parseStaySearch(Object.fromEntries(query.entries()));
  const { language, t } = usePublicLanguage();
  const { id } = useParams() as { id: string };
  const [property, setProperty] = useState<Omit<PropertyData, 'bookedDates'> | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentMonth, setCurrentMonth] = useState(new Date(`${initial?.checkIn ?? todayKst()}T00:00:00`));
  const [checkIn, setCheckIn] = useState<Date | null>(initial ? new Date(`${initial.checkIn}T00:00:00`) : null);
  const [checkOut, setCheckOut] = useState<Date | null>(initial ? new Date(`${initial.checkOut}T00:00:00`) : null);

  const [calendarResult, setCalendarResult] = useState<{ key: string; data: StayCalendar } | null>(null);
  const [calendarError, setCalendarError] = useState('');
  const [calendarRetry, setCalendarRetry] = useState(0);
  const monthKey = format(currentMonth, 'yyyy-MM');
  const calendarKey = `${property?.id}:${monthKey}:${calendarRetry}`;
  const calendar = calendarResult?.key === calendarKey ? calendarResult.data : null;
  useEffect(() => {
    if (!property?.id || property.status !== 'active') return;
    const controller = new AbortController();
    setCalendarError('');
    const month = new Date(`${monthKey}-01T00:00:00`);
    const query = new URLSearchParams({ propertyId: property.id,
      start: format(addDays(month, -30), 'yyyy-MM-dd'), end: format(endOfMonth(month), 'yyyy-MM-dd') });
    fetch(`/api/public/stay-calendar?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "예약 가능 날짜를 불러오지 못했습니다.");
        if (!controller.signal.aborted) setCalendarResult({ key: calendarKey, data });
      }).catch(error => {
        if (!controller.signal.aborted) setCalendarError(error instanceof Error ? error.message : "날짜 조회에 실패했습니다.");
      });
    return () => controller.abort();
  }, [property?.id, property?.status, monthKey, calendarKey]);
  useEffect(() => {
    const refresh = () => setCalendarRetry(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const selectedStayIssue = checkIn && checkOut
    ? stayIssue(calendar, format(checkIn, 'yyyy-MM-dd'), format(checkOut, 'yyyy-MM-dd')) : null;

  const [guests, setGuests] = useState(initial?.guests ?? 2);
  const [pets, setPets] = useState(initial?.pets ?? 0);
  const [optionPolicy, setOptionPolicy] = useState<{ baseGuests: number; extraGuestFeeKrw: number; maxPets: number; petFeesKrw: number[] } | null>(null);
  const [stayPrice, setStayPrice] = useState<{ priceKrw: number; nights: number; includesAllFees: boolean; stayOptions: StayOptions | null } | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState('');
  useEffect(() => {
    setStayPrice(null); setPriceError(''); setPriceLoading(false);
    if (!property?.id || property.status !== 'active' || !checkIn || !checkOut) return;
    const controller = new AbortController();
    setPriceLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/public/checkout', { method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'price', propertyId: property.id, checkIn: format(checkIn, 'yyyy-MM-dd'), checkOut: format(checkOut, 'yyyy-MM-dd'), guests, pets }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "요금을 불러오지 못했습니다.");
        if (!controller.signal.aborted) setStayPrice(data);
      } catch (error) {
        if (!controller.signal.aborted) setPriceError(error instanceof Error ? error.message : "요금 조회에 실패했습니다.");
      } finally { if (!controller.signal.aborted) setPriceLoading(false); }
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [property?.id, property?.status, checkIn, checkOut, guests, pets]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [checkoutMethods, setCheckoutMethods] = useState<string[]>([]);
  const [gateway, setGateway] = useState('card');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchProperty = async () => {
      try {
        const res = await fetch(`/api/public/properties/${id}`);
        if (res.ok) {
          const data = await res.json();
          setOptionPolicy(data.stayOptionPolicy ?? null);
          setCheckoutMethods(data.checkoutMethods ?? []);
          setGateway(data.checkoutMethods?.[0] ?? 'card');
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
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchProperty();
  }, [id]);

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const isSelectingCheckout = checkIn && !checkOut;
  const dateIssue = (date: Date): string | null => {
    if (isBefore(date, new Date(`${todayKst()}T00:00:00`))) return t("지난 날짜");
    const key = format(date, 'yyyy-MM-dd');
    return checkIn && !checkOut && date > checkIn
      ? stayIssue(calendar, format(checkIn, 'yyyy-MM-dd'), key)
      : arrivalIssue(calendar, key);
  };
  const handleDateClick = (date: Date) => {
    if (dateIssue(date)) return;
    if (checkIn && !checkOut && date > checkIn) setCheckOut(date);
    else { setCheckIn(date); setCheckOut(null); }
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
    if (isSubmitting || !checkIn || !checkOut || !name || !phone || !email || selectedStayIssue || !stayPrice || priceLoading || priceError) return;
    if (!checkoutMethods.includes(gateway)) {
      setErrorMessage(t("현재 온라인 결제를 준비 중입니다. 잠시 후 다시 시도해주세요."));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/public/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: property!.id,
          action: 'quote',
          gateway,
          propertyName: property?.name || '',
          checkIn: format(checkIn, 'yyyy-MM-dd'),
          checkOut: format(checkOut, 'yyyy-MM-dd'),
          guests,
          pets,
          name,
          phone,
          email,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("예약 실패"));
      }

      const quote = await res.json();
      window.location.assign(`/book/checkout/${quote.id}#token=${encodeURIComponent(quote.token)}`);
    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error ? error.message : t("예약에 실패했습니다. 다시 시도해주세요.");
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
        <p className="font-serif text-2xl">{t("숙소를 찾을 수 없습니다.")}</p>
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-50 transition-colors underline underline-offset-4">{t("메인으로 돌아가기")}</Link>
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
    <div className="min-h-screen pb-24 lg:pb-0 bg-[#0C0A09] text-stone-50 selection:bg-stone-400/20">

      <BookingPhotoGallery images={property.images?.length ? property.images : [property.imageUrl || '/images/main_yard.webp']} name={t(property.name)} english={language === 'en'} />
      <header id="stay-details" className="mx-auto max-w-7xl scroll-mt-24 px-4 pb-2 pt-8 sm:px-6 sm:pt-10">
        <p className="mb-3 text-xs uppercase tracking-[0.2em] text-stone-400">{property.region ? t(property.region) : 'void anchae'} · HANOK STAY</p>
        <h1 className="font-serif text-4xl font-light tracking-tight sm:text-5xl">{t(property.name)}</h1>
        {property.catchphrase && <p className="mt-4 text-lg text-stone-300">{t(property.catchphrase)}</p>}
        {property.addressKo && <a href="#stay-location" className="mt-3 inline-flex min-h-11 items-center text-sm text-stone-400 underline underline-offset-4">{property.addressKo}</a>}
      </header>

      {/* Property Info Bar */}
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-stone-400 border-b border-stone-800">
        {property.checkInTime && (
          <div className="flex items-center gap-2">
            <Clock size={15} className="text-stone-500" />
            <span>{t("체크인")}{property.checkInTime}</span>
          </div>
        )}
        {property.checkOutTime && (
          <div className="flex items-center gap-2">
            <Clock size={15} className="text-stone-500" />
            <span>{t("체크아웃")}{property.checkOutTime}</span>
          </div>
        )}
        {property.maxGuests && (
          <div className="flex items-center gap-2">
            <UsersIcon size={15} className="text-stone-500" />
            <span>{language === 'en' ? `Base ${BASE_GUESTS} guests · Up to ${property.maxGuests} guests` : `기준 ${BASE_GUESTS}인 · 최대 ${property.maxGuests}인`}</span>
          </div>
        )}
      </div>

      <nav aria-label={language === 'en' ? 'Stay sections' : '숙소 상세 메뉴'} className="mx-auto flex max-w-7xl gap-6 overflow-x-auto border-b border-stone-800 px-4 text-sm sm:px-6">
        <a href="#stay-gallery" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'Gallery' : '갤러리'}</a>
        <a href="#stay-description" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'About the stay' : '숙소 소개'}</a>
        <a href="#calendar-selection" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'Dates & rates' : '날짜·요금'}</a>
        <a href="#stay-location" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'Location' : '위치 안내'}</a>
      </nav>
      <section id="stay-description" className="mx-auto max-w-7xl scroll-mt-24 px-4 pt-8 sm:px-6">
        <h2 className="mb-4 text-xl font-medium">{language === 'en' ? 'About the stay' : '숙소 소개'}</h2>
        <p className="max-w-3xl whitespace-pre-line text-sm leading-7 text-stone-300">{property.description ? t(property.description) : property.catchphrase ? t(property.catchphrase) : t(property.name)}</p>
      </section>

      {property.status === 'coming_soon' ? (
        /* Coming Soon Panel — 캘린더/폼 대신 오픈 예정 안내 */
        <div className="max-w-2xl mx-auto px-6 py-24 md:py-32 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-amber-400 mb-6 font-semibold">
            Coming Soon
          </p>
          <h2 className="font-serif text-3xl md:text-5xl font-light mb-6 tracking-tight text-stone-100">
            {property.openingDate
              ? `${property.openingDate.replace(/^(\d{4})-(\d{2}).*/, '$2월')} 오픈 예정`
              : t("오픈 예정")}
          </h2>
          <p className="text-stone-400 text-base md:text-lg font-light leading-relaxed max-w-lg mx-auto mb-12">
            {t(property.name)}{t("은 곧 새로운 손님을 맞이할 준비를 하고 있습니다. 오픈 소식은 홈에서 먼저 안내드리겠습니다.")}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-3 px-8 py-4 border border-stone-700 rounded-full text-sm uppercase tracking-widest text-stone-300 hover:bg-stone-100 hover:text-stone-900 hover:border-stone-100 transition-colors duration-500"
          >{t("메인으로")}<ArrowRight size={16} />
          </Link>
        </div>
      ) : (
      <div id="booking-dates" className="scroll-mt-24 max-w-7xl mx-auto px-4 md:px-6 py-10 md:py-12 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20">

        {/* Left: Calendar */}
        <div className="lg:col-span-7 space-y-8">
          <BookingPhotoGallery variant="content" images={property.images?.length ? property.images : [property.imageUrl || '/images/main_yard.webp']} name={t(property.name)} english={language === 'en'} />
          <div id="calendar-selection" className="scroll-mt-24" />
          <div>
            <h2 className="font-serif text-3xl md:text-4xl font-light mb-2">{t("날짜 선택")}</h2>
            <p className="text-stone-500 text-sm font-light tracking-wide">{!checkIn ? t("체크인 날짜를 선택해주세요.") : !checkOut ? t("체크아웃 날짜를 선택해주세요.") : language === 'en' ? `${nightCount} night(s) selected.` : `${nightCount}박 일정이 선택되었습니다.`}</p>
          </div>

          <div role="status" aria-live="polite" className="text-sm text-stone-300 space-y-2">
            {calendarError ? <><p className="text-amber-300">{t(calendarError)}</p><button type="button" onClick={() => setCalendarRetry(value => value + 1)} className="min-h-11 underline underline-offset-4">{t("날짜 다시 불러오기")}</button></>
              : !calendar ? <p>{t("예약 가능 날짜를 확인하고 있습니다…")}</p>
              : <p>{t("숙소의 최신 판매 일정입니다. 날짜·인원 선택 후 최종 요금을 확인합니다.")}</p>}
            {checkIn && calendar && <p>{format(checkIn, language === 'en' ? 'MMM d' : 'M월 d일')}{t("체크인 · 최소")}{calendar.days[format(checkIn, 'yyyy-MM-dd')]?.minStay ?? t("확인 중")}{t("박")}</p>}
            {checkIn && <button type="button" onClick={() => { setCheckIn(null); setCheckOut(null); }} className="min-h-11 underline underline-offset-4">{t("날짜 선택 초기화")}</button>}
            {selectedStayIssue && <p className="text-amber-300">{t(selectedStayIssue)}</p>}
          </div>
          <div className="bg-stone-900 border border-stone-800 rounded-2xl p-3 sm:p-6 md:p-10">
            <div className="flex justify-between items-center mb-8">
              <h3 className="font-serif text-xl md:text-2xl font-light tracking-wide">
                {format(currentMonth, language === 'en' ? 'MMMM yyyy' : 'yyyy년 M월', { locale: language === 'en' ? enUS : ko })}
              </h3>
              <div className="flex gap-2">
                <button onClick={prevMonth} disabled={monthKey <= format(new Date(`${todayKst()}T00:00:00`), 'yyyy-MM')} className="p-3 border border-stone-800 rounded-full disabled:opacity-30 hover:bg-stone-800/40 transition-colors" aria-label={t("이전 달")}>
                  <ChevronLeft size={18} className="text-stone-300" />
                </button>
                <button onClick={nextMonth} className="p-3 border border-stone-800 rounded-full hover:bg-stone-800/40 transition-colors" aria-label={t("다음 달")}>
                  <ChevronRight size={18} className="text-stone-300" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-y-4 gap-x-1 text-center mb-4">
              {[t("일"), t("월"), t("화"), t("수"), t("목"), t("금"), t("토")].map(day => (
                <div key={day} className="text-xs uppercase tracking-widest text-stone-500 font-medium py-2">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-1.5 gap-x-0.5 text-center">
              {emptyDays.map(i => (
                <div key={`empty-${i}`} className="h-11"></div>
              ))}
              {daysInMonth.map(date => {
                const isPast = isBefore(date, new Date(`${todayKst()}T00:00:00`));
                const day = calendar?.days[format(date, 'yyyy-MM-dd')];
                const issue = dateIssue(date);
                const isBooked = !!day && day.available < 1;
                const isSelected = isDateSelected(date);
                const inRange = isDateInRange(date);
                const isStart = checkIn && isSameDay(date, checkIn);
                const isEnd = checkOut && isSameDay(date, checkOut);
                const isOnlyStart = isStart && !checkOut;
                const canClickForCheckout = !!isSelectingCheckout && !!checkIn && date > checkIn && !issue;
                const isDisabled = !!issue;

                return (
                  <button
                    key={date.toString()}
                    onClick={() => handleDateClick(date)}
                    disabled={isDisabled}
                    aria-pressed={!!isSelected}
                    className={`
                      relative h-11 w-full flex items-center justify-center text-sm transition-all duration-200 rounded-full
                      ${isDisabled
                        ? isBooked && !isPast
                          ? 'bg-stone-800/40 text-stone-700 cursor-not-allowed line-through decoration-stone-600'
                          : 'text-stone-600 cursor-not-allowed'
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
                    aria-label={`${format(date, language === 'en' ? 'MMM d' : 'M월 d일')}${issue ? ` ${t(issue)}` : canClickForCheckout ? t(" 체크아웃 가능") : language === 'en' ? ` Check-in available, minimum ${day?.minStay ?? 1} nights` : ` 체크인 선택 가능, 최소 ${day?.minStay ?? 1}박`}`}
                  >
                    <span className="relative z-10">{format(date, 'd')}</span>
                    {isBooked && !isPast && !canClickForCheckout && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-red-400/60"></span>
                    )}
                    {canClickForCheckout && !isSelected && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-amber-400/60"></span>
                    )}
                    {!isDisabled && !isPast && !isBooked && !isSelected && !inRange && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-400/50"></span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-2 mt-6 pt-5 border-t border-stone-800/60">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400/50"></span>
                <span className="text-xs text-stone-500 tracking-wide">{t("날짜 선택 가능")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-400/60"></span>
                <span className="text-xs text-stone-500 tracking-wide">{t("판매 마감")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-stone-100"></span>
                <span className="text-xs text-stone-500 tracking-wide">{t("선택됨")}</span>
              </div>
            </div>
          </div>
          {checkIn && checkOut && (
            <div className="lg:hidden rounded-xl border border-stone-700 p-4 space-y-3" aria-live="polite">
              <p className="text-sm text-stone-200">{format(checkIn, language === 'en' ? 'MMM d' : 'M월 d일')} → {format(checkOut, language === 'en' ? 'MMM d' : 'M월 d일')} · {nightCount}{t("박")}</p>
              <a href="#booking-details" className="flex min-h-12 items-center justify-center rounded-lg bg-[#eee8dc] text-sm font-medium text-stone-950">{t("이 일정으로 예약 정보 입력")}</a>
            </div>
          )}
        </div>

        {/* Right: Booking Form */}
        <div id="booking-details" className="lg:col-span-5 scroll-mt-24">
          <div className="lg:sticky lg:top-24 space-y-8 rounded-2xl border border-stone-700 bg-stone-900/40 p-5 sm:p-7">
            <div>
              <h2 className="font-serif text-3xl md:text-4xl font-light mb-2">{t("예약")}</h2>
              <p className="text-stone-500 text-sm font-light tracking-wide">{t("예약 정보를 입력해주세요.")}</p>
            </div>

            {/* Error Toast */}
            {errorMessage && (
              <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl px-5 py-4">
                <p className="text-red-300 text-sm flex-1">{t(errorMessage)}</p>
                <button onClick={() => setErrorMessage(null)} className="text-red-300/60 hover:text-red-300 transition-colors" aria-label={t("닫기")}>
                  <X size={16} />
                </button>
              </div>
            )}

            <form onSubmit={handleBooking} className="space-y-6">
              {/* Date Summary */}
              <div className="flex items-center justify-between py-5 border-y border-stone-800">
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-widest text-stone-500 mb-1.5">{t("체크인")}</p>
                  <p className="font-serif text-lg md:text-xl">{checkIn ? format(checkIn, language === 'en' ? 'MMM d (EEE)' : 'MM월 dd일 (eee)', { locale: language === 'en' ? enUS : ko }) : t("날짜 선택")}</p>
                </div>
                <div className="flex flex-col items-center mx-3">
                  <ArrowRight size={14} className="text-stone-700" />
                  {nightCount > 0 && (
                    <span className="text-xs text-stone-500 mt-1">{nightCount}{t("박")}</span>
                  )}
                </div>
                <div className="flex-1 text-right">
                  <p className="text-xs uppercase tracking-widest text-stone-500 mb-1.5">{t("체크아웃")}</p>
                  <p className="font-serif text-lg md:text-xl">{checkOut ? format(checkOut, language === 'en' ? 'MMM d (EEE)' : 'MM월 dd일 (eee)', { locale: language === 'en' ? enUS : ko }) : t("날짜 선택")}</p>
                </div>
              </div>

              <a href="#calendar-selection" className="inline-flex min-h-11 items-center text-sm text-stone-300 underline underline-offset-4">{t("날짜 다시 선택")}</a>

              {/* Guests */}
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-stone-500">{t("인원")}</label>
                <div className="flex items-center justify-between border border-stone-700 rounded-full p-2 bg-stone-800/40">
                  <button
                    type="button"
                    onClick={() => setGuests(Math.max(1, guests - 1))}
                    className="w-11 h-11 disabled:opacity-30 rounded-full flex items-center justify-center hover:bg-stone-800/60 transition-colors text-xl font-light"
                    disabled={guests <= 1}
                    aria-label={t("인원 감소")}
                  >-</button>
                  <span className="font-serif text-xl">{guests}</span>
                  <button
                    type="button"
                    onClick={() => setGuests(Math.min(maxGuests, guests + 1))}
                    className="w-11 h-11 disabled:opacity-30 rounded-full flex items-center justify-center hover:bg-stone-800/60 transition-colors text-xl font-light"
                    disabled={guests >= maxGuests}
                    aria-label={t("인원 증가")}
                  >+</button>
                </div>
                {property.maxGuests && (
                  <p className="text-xs text-stone-600 text-right">{language === 'en' ? `Base ${BASE_GUESTS} guests · Up to ${property.maxGuests} guests` : `기준 ${BASE_GUESTS}인 · 최대 ${property.maxGuests}인`}</p>
                )}
              </div>

              {/* Guest Info */}
              <div className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="guest-name" className="text-sm text-stone-400">{t("이름")}</label>
                  <input
                    id="guest-name"
                    autoComplete="name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-transparent border-b border-stone-700 py-3 text-base text-stone-50 font-light focus:outline-none focus:border-stone-400 transition-colors placeholder:text-stone-700"
                    placeholder={t("홍길동")}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="guest-phone" className="text-sm text-stone-400">{t("연락처")}</label>
                  <input
                    id="guest-phone"
                    autoComplete="tel"
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-transparent border-b border-stone-700 py-3 text-base text-stone-50 font-light focus:outline-none focus:border-stone-400 transition-colors placeholder:text-stone-700"
                    placeholder={language === 'en' ? '+1 202 555 0123' : '010-1234-5678'}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="guest-email" className="text-sm text-stone-400">{t("이메일 주소")}</label>
                  <input
                    id="guest-email"
                    autoComplete="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-transparent border-b border-stone-700 py-3 text-base text-stone-50 font-light focus:outline-none focus:border-stone-400 transition-colors placeholder:text-stone-700"
                    placeholder="example@email.com"
                  />
                </div>
              </div>

              {checkIn && checkOut && <section aria-live="polite" className="border border-stone-700 p-5 space-y-2">
                <h3 className="text-sm text-stone-300">{stayPrice?.includesAllFees ? t("총 숙박요금") : t("숙박요금")}</h3>
                {priceLoading && <p className="text-sm text-stone-400">{t("선택한 날짜의 요금을 확인하고 있습니다…")}</p>}
                {stayPrice && <><p className="text-2xl text-stone-100">₩{stayPrice.priceKrw.toLocaleString()} <span className="text-sm">/ {stayPrice.nights}{t("박 ·")}{guests}{t("명")}</span></p>
                  <p className="text-xs text-stone-400">{stayPrice.includesAllFees
                    ? t("결제 전 요금과 예약 가능 여부를 다시 확인합니다. PayPal 결제 시 다음 화면에서 USD 금액을 확인할 수 있습니다.")
                    : t("표시 금액은 숙박요금입니다. 세금·청소비 등 필수 추가 요금의 포함 여부와 최종 금액은 예약 시 확인해주세요.")}</p></>}
                {stayPrice?.stayOptions && <dl className="text-sm text-stone-300 space-y-1">
                  <div className="flex justify-between"><dt>{t("기본 숙박요금")}</dt><dd>₩{stayPrice.stayOptions.basePriceKrw.toLocaleString()}</dd></div>
                  <div className="flex justify-between"><dt>{t("추가")}{stayPrice.stayOptions.extraGuests}{t("인 · 숙박 1회")}</dt><dd>₩{stayPrice.stayOptions.extraGuestFeeKrw.toLocaleString()}</dd></div>
                  <div className="flex justify-between"><dt>{t("반려견")}{stayPrice.stayOptions.pets}{t("마리 · 숙박 1회")}</dt><dd>₩{stayPrice.stayOptions.petFeeKrw.toLocaleString()}</dd></div>
                </dl>}
                {priceError && <p className="text-sm text-amber-300">{t(priceError)}</p>}
              </section>}
              {optionPolicy && <fieldset className="space-y-3 border border-stone-700 p-5">
                <legend className="text-sm px-2">{t("숙박 옵션")}</legend>
                <p className="text-sm text-stone-300">{t("기준")}{optionPolicy.baseGuests}{t("인 · 추가 인원 1인")}{optionPolicy.extraGuestFeeKrw.toLocaleString()}{t("원 / 숙박 1회")}</p>
                <p className="text-xs text-stone-400">{t("선택한 총 인원에서 기준 인원을 초과한 인원만 자동 계산합니다. 연박에도 옵션 요금은 한 번만 부과됩니다.")}</p>
                {optionPolicy.maxPets > 0 ? <>
                  <label htmlFor="stay-pets" className="block text-sm">{t("반려견 동반 · 최대")}{optionPolicy.maxPets}{t("마리")}</label>
                  <select id="stay-pets" value={pets} onChange={e => setPets(Number(e.target.value))} className="w-full min-h-12 bg-stone-900 border border-stone-700 p-3 text-base">
                    <option value={0}>{t("동반하지 않음")}</option>
                    <option value={1}>{t("1마리 · 70,000원 / 숙박 1회")}</option>
                    <option value={2}>{t("2마리 · 100,000원 / 숙박 1회")}</option>
                  </select>
                </> : <p className="text-sm text-stone-300">{t("도원재는 반려견 입실이 불가합니다.")}</p>}
              </fieldset>}
              {checkoutMethods.length > 0 && <fieldset className="space-y-3">
                <legend className="text-sm mb-2">{t("결제수단 / Payment method")}</legend>
                {checkoutMethods.map(method => <label key={method} className="flex items-center gap-3 border border-stone-700 p-4 cursor-pointer">
                  <input type="radio" name="gateway" value={method} checked={gateway === method} onChange={() => setGateway(method)} />
                  {method === 'paypal' ? 'PayPal · USD' : t("카드·간편결제 / Card · KRW")}
                </label>)}
                <p className="text-sm text-stone-400">{t("다음 화면에서 최종 요금과 취소 규정을 확인합니다.")}</p>
              </fieldset>}
              {checkoutMethods.length === 0 && <p role="status" className="text-sm text-amber-300">{t("현재 온라인 결제를 준비 중입니다. 잠시 후 다시 시도해주세요.")}</p>}
              <button
                type="submit"
                disabled={!checkoutMethods.includes(gateway) || !checkIn || !checkOut || !name || !phone || !email || isSubmitting || !!selectedStayIssue || !stayPrice || priceLoading || !!priceError}
                className={`
                  w-full py-5 rounded-full text-sm uppercase tracking-widest font-medium transition-all duration-500
                  ${checkoutMethods.includes(gateway) && checkIn && checkOut && name && phone && email && !selectedStayIssue && stayPrice && !priceLoading && !priceError
                    ? 'bg-stone-100 text-stone-900 hover:bg-stone-200 shadow-[0_0_40px_rgba(214,211,209,0.15)]'
                    : 'bg-stone-800/60 text-stone-600 cursor-not-allowed'}
                `}
              >
                {isSubmitting ? t("결제 페이지로 이동 중...") : t("결제 페이지로 이동 / Continue to payment")}
              </button>

              {!checkIn && (
                <p className="text-center text-xs text-stone-600">{t("먼저 캘린더에서 체크인 날짜를 선택해주세요")}</p>
              )}
              {checkIn && !checkOut && (
                <p className="text-center text-xs text-stone-600">{t("체크아웃 날짜를 선택해주세요")}</p>
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

      <section id="stay-location" className="mx-auto max-w-7xl scroll-mt-24 border-t border-stone-800 px-4 py-10 sm:px-6">
        <h2 className="mb-4 text-xl font-medium">{language === 'en' ? 'Location' : '위치 안내'}</h2>
        <p className="text-sm text-stone-300">{property.addressKo || (language === 'en' ? 'Please contact us for the exact address.' : '상세 위치는 숙소로 문의해 주세요.')}</p>
      </section>
      {property.status !== 'coming_soon' && <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-stone-700 bg-stone-950/95 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="min-w-0 text-sm"><p className="truncate">{t(property.name)}</p><p className="mt-1 text-xs text-stone-400">{checkIn && checkOut ? format(checkIn, 'M.d') + ' — ' + format(checkOut, 'M.d') : language === 'en' ? 'Choose dates to view rates' : '날짜 선택 후 요금 확인'}</p></div>
        <a href="#calendar-selection" className="flex min-h-11 shrink-0 items-center rounded-lg bg-[#eee8dc] px-5 text-sm font-medium text-stone-950">{language === 'en' ? 'Dates & rates' : '날짜·요금 확인'}</a>
      </div>}
    </div>
  );
}
