'use client';

import { usePublicLanguage } from '@/components/PublicLanguage';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { parseStaySearch } from '@/lib/stay-search';
import { BookingPhotoGallery } from '@/components/BookingPhotoGallery';
import JongnoEventRecommendations from '@/components/JongnoEventRecommendations';
import { getPropertyDisplay } from '@/lib/property-display';
import { NavigationLink as Link } from '@/components/NavigationFeedback';
import { ChevronLeft, ChevronRight, ArrowRight, Clock, Users as UsersIcon, X } from 'lucide-react';
import { format, addDays, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isBefore } from 'date-fns';
import { ko, enUS } from 'date-fns/locale';
import type { PublicBookingProperty } from '@/lib/public-booking-property';
import { refundPolicyRows } from '@/lib/refund-policy-display';
import type { StayOptions } from '@/lib/payments/stay-options';
import { todayKst } from '@/lib/dates';
import { arrivalIssue, stayIssue, type StayCalendar } from '@/lib/stay-calendar';
import StayTourSelector, { tourSelectionIssue } from './StayTourSelector';
import { tourInquiryReceiptSignature, tourSelectionsForSubmission } from './tour-selection';
import type { StayTourSelectionInput } from '@/lib/stay-tour-types';
import styles from './booking.module.css';

export default function BookingContent({ property }: { property: PublicBookingProperty }) {
  const query = useSearchParams();
  const initial = parseStaySearch(Object.fromEntries(query.entries()));
  const { language, t } = usePublicLanguage();
  const id = property.id;

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
  const optionPolicy = property.stayOptionPolicy;
  const [stayPrice, setStayPrice] = useState<{ priceKrw: number; nights: number; includesAllFees: boolean; stayOptions: StayOptions | null } | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState('');
  const [priceRetry, setPriceRetry] = useState(0);
  useEffect(() => {
    setStayPrice(null); setPriceError(''); setPriceLoading(false);
    if (!property?.id || property.status !== 'active' || !property.checkoutMethods.length || !checkIn || !checkOut || checkOut <= checkIn) return;
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
  }, [property?.id, property?.status, checkIn, checkOut, guests, pets, priceRetry]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [tourSelections, setTourSelections] = useState<StayTourSelectionInput[]>([]);
  const [inquiryBusy, setInquiryBusy] = useState(false);
  const inquiryAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const inquirySubmitting = useRef(false);
  const [inquiryReceipt, setInquiryReceipt] = useState<{ fingerprint: string; signature: string; ids: string[] } | null>(null);
  const checkoutMethods = property.checkoutMethods;
  const [gateway, setGateway] = useState(property.checkoutMethods[0] ?? 'card');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const bookingSubmitting = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedTourIssue = tourSelectionIssue(tourSelections, checkIn ? format(checkIn, 'yyyy-MM-dd') : '', checkOut ? format(checkOut, 'yyyy-MM-dd') : '', guests, language === 'en');
  const submittedTourSelections = tourSelectionsForSubmission(tourSelections);
  const inquiryPayload = {
    propertyId: property.id, checkIn: checkIn ? format(checkIn, 'yyyy-MM-dd') : '', checkOut: checkOut ? format(checkOut, 'yyyy-MM-dd') : '',
    guests, name: name.trim(), phone: phone.trim(), ...(email.trim() ? { email: email.trim() } : {}), tourSelections: submittedTourSelections,
  };
  const inquiryFingerprint = JSON.stringify(inquiryPayload);
  const inquirySignature = tourInquiryReceiptSignature(inquiryPayload);
  const inquiryAlreadySent = inquiryReceipt?.fingerprint === inquiryFingerprint;
  const toursAlreadyRequested = inquiryReceipt?.signature === inquirySignature;

  async function submitTourInquiry() {
    if (inquirySubmitting.current || inquiryBusy || bookingSubmitting.current || isSubmitting || toursAlreadyRequested) return;
    if (!checkIn || !checkOut || inquiryPayload.checkIn < todayKst() || inquiryPayload.checkOut <= inquiryPayload.checkIn) {
      setErrorMessage(language === 'en' ? 'Enter valid planned stay dates, starting today or later.' : '오늘 이후의 숙박 예정일을 입력해 주세요. 체크아웃은 체크인 다음 날부터 선택할 수 있습니다.');
      return;
    }
    if (!tourSelections.length || selectedTourIssue) { setErrorMessage(selectedTourIssue || (language === 'en' ? 'Choose a tour first.' : '문의할 투어를 먼저 선택해 주세요.')); return; }
    if (!name.trim() || !phone.trim()) { setErrorMessage(language === 'en' ? 'Enter your name and phone number for the tour request.' : '투어 문의에 필요한 이름과 연락처를 입력해 주세요.'); return; }
    const emailInput = document.getElementById('guest-email') as HTMLInputElement | null;
    if (email.trim() && emailInput && !emailInput.validity.valid) { setErrorMessage(language === 'en' ? 'Check your email address.' : '이메일 주소를 확인해 주세요.'); return; }
    if (inquiryAttempt.current?.fingerprint !== inquiryFingerprint) inquiryAttempt.current = { fingerprint: inquiryFingerprint, key: crypto.randomUUID() };
    inquirySubmitting.current = true;
    setInquiryBusy(true); setErrorMessage(null);
    try {
      const response = await fetch('/api/public/stay-tours', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...inquiryPayload, idempotencyKey: inquiryAttempt.current.key }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || (language === 'en' ? 'The tour request could not be sent. Please try again.' : '투어 문의를 접수하지 못했습니다. 다시 시도해 주세요.'));
      if (!result.success || result.lodgingBooked !== false || !Array.isArray(result.inquiries)) throw new Error(language === 'en' ? 'The result could not be confirmed. Retry with the same details.' : '접수 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.');
      setInquiryReceipt({ fingerprint: inquiryFingerprint, signature: inquirySignature, ids: result.inquiries.map((item: { id: string }) => item.id) });
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : language === 'en' ? 'The tour request could not be sent.' : '투어 문의를 접수하지 못했습니다.'); }
    finally { inquirySubmitting.current = false; setInquiryBusy(false); }
  }

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
    if (bookingSubmitting.current || isSubmitting || inquirySubmitting.current || inquiryBusy || !checkIn || !checkOut || !name || !phone || !email || selectedStayIssue || !stayPrice || priceLoading || priceError) return;
    if (selectedTourIssue) { setErrorMessage(selectedTourIssue); return; }
    if (!checkoutMethods.includes(gateway)) {
      setErrorMessage(t("현재 온라인 결제를 준비 중입니다. 잠시 후 다시 시도해주세요."));
      return;
    }

    bookingSubmitting.current = true;
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
          tourSelections: toursAlreadyRequested ? [] : submittedTourSelections,
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
      bookingSubmitting.current = false;
      setIsSubmitting(false);
    }
  };

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const startDayOfWeek = startOfMonth(currentMonth).getDay();
  const emptyDays = Array.from({ length: startDayOfWeek }, (_, i) => i);

  const nightCount = checkIn && checkOut
    ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;
  const baseGuests = optionPolicy?.baseGuests ?? property.baseGuests;
  const refundRows = property.refundPolicy ? refundPolicyRows(property.refundPolicy, language === 'en' ? 'en' : 'ko') : [];

  return (
    <div className={`${styles.page} min-h-screen pb-28 lg:pb-0 bg-[#0C0A09] text-stone-50 selection:bg-stone-400/20`}>

      {property.images.length > 0 || property.imageUrl ? <BookingPhotoGallery images={property.images.length ? property.images : [property.imageUrl!]} name={t(property.name)} english={language === 'en'} /> : <div id="stay-gallery" className="mx-auto max-w-7xl px-4 pb-6 pt-28 text-sm text-stone-300">{language === 'en' ? 'Photos for this stay will be available soon.' : '숙소 사진을 준비하고 있습니다.'}</div>}
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
            <span>{language === 'en' ? `Base ${baseGuests} guests · Up to ${property.maxGuests} guests` : `기준 ${baseGuests}인 · 최대 ${property.maxGuests}인`}</span>
          </div>
        )}
      </div>

      <nav aria-label={language === 'en' ? 'Stay sections' : '숙소 상세 메뉴'} className="mx-auto flex max-w-7xl flex-wrap gap-x-5 border-b border-stone-700 bg-stone-950 px-4 text-sm sm:px-6">
        <a href="#stay-gallery" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'Gallery' : '갤러리'}</a>
        <a href="#stay-description" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'About the stay' : '숙소 소개'}</a>
        <a href="#stay-facilities" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'Facilities' : '시설 요약'}</a>
        <a href="#stay-refund" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'Refund policy' : '환불 규정'}</a>
        {property.status === 'active' && <>
          <a href="#calendar-selection" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'Dates & rates' : '날짜·요금'}</a>
          <a href="#stay-tours" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'Optional tours' : '옵션 투어'}</a>
        </>}
        <a href="#stay-location" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'Location' : '위치 안내'}</a>
      </nav>
      <section id="stay-description" className="mx-auto max-w-7xl scroll-mt-24 px-4 pt-8 sm:px-6">
        <h2 className="mb-4 text-xl font-medium">{language === 'en' ? 'About the stay' : '숙소 소개'}</h2>
        <p className="max-w-3xl whitespace-pre-line text-sm leading-7 text-stone-300">{property.description ? t(property.description) : property.catchphrase ? t(property.catchphrase) : t(property.name)}</p>
      </section>

      <section id="stay-facilities" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-10 sm:px-6">
        <h2 className="mb-5 font-serif text-2xl">{language === 'en' ? 'Your stay at a glance' : '시설 요약'}</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-stone-700 py-6 text-sm sm:grid-cols-4">
          <div><dt className="mb-2 text-stone-400">{t('인원')}</dt><dd>{language === 'en' ? `Base ${baseGuests} guests` : `기준 ${baseGuests}인`}{property.maxGuests ? <span className="mt-1 block text-stone-300">{language === 'en' ? `Up to ${property.maxGuests} guests` : `최대 ${property.maxGuests}인`}</span> : null}</dd></div>
          <div><dt className="mb-2 text-stone-400">{t('체크인')}</dt><dd>{property.checkInTime || (language === 'en' ? 'Contact the stay' : '숙소 문의')}</dd></div>
          <div><dt className="mb-2 text-stone-400">{t('체크아웃')}</dt><dd>{property.checkOutTime || (language === 'en' ? 'Contact the stay' : '숙소 문의')}</dd></div>
          <div><dt className="mb-2 text-stone-400">{language === 'en' ? 'Dogs' : '반려견 동반'}</dt><dd>{optionPolicy ? optionPolicy.maxPets > 0 ? language === 'en' ? `Up to ${optionPolicy.maxPets} dogs, additional fee` : `최대 ${optionPolicy.maxPets}마리, 추가 요금` : language === 'en' ? 'Not permitted' : '동반 불가' : language === 'en' ? 'Contact the stay' : '숙소 문의'}</dd></div>
        </dl>
        {property.amenities.length > 0 ? <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm leading-6 text-stone-300 sm:grid-cols-3">{property.amenities.map(item => <li key={item} className="break-words">{t(item)}</li>)}</ul> : <p className="mt-5 text-sm text-stone-400">{language === 'en' ? 'Please contact the stay about specific facilities or equipment.' : '필요한 시설·비품은 예약 전 숙소에 문의해 주세요.'}</p>}
      </section>

      <section id="stay-refund" className="mx-auto max-w-7xl scroll-mt-24 border-t border-stone-700 px-4 py-10 sm:px-6">
        <div className="grid gap-6 md:grid-cols-[1fr_1.5fr] md:gap-12">
          <div><h2 className="font-serif text-2xl">{language === 'en' ? 'Cancellation & refunds' : '취소 및 환불 규정'}</h2><p className="mt-3 text-sm leading-6 text-stone-300">{language === 'en' ? 'Review the policy before selecting your dates. The policy for your booking is saved on the payment page.' : '예약 전 환불 기준을 확인해 주세요. 결제 화면에 표시된 규정이 해당 예약에 저장됩니다.'}</p></div>
          {refundRows.length > 0 ? <table className="w-full border-collapse text-left text-sm"><caption className="mb-3 text-left text-stone-300">{language === 'en' ? 'Days before check-in · Refund percentage' : '체크인 날짜 기준 · 환불 비율'}</caption><thead><tr className="border-b border-stone-500"><th scope="col" className="py-3 font-medium">{language === 'en' ? 'Cancellation date' : '취소 시점'}</th><th scope="col" className="py-3 text-right font-medium">{language === 'en' ? 'Refund' : '환불 비율'}</th></tr></thead><tbody>{refundRows.map(row => <tr key={row.minDaysBefore} className="border-b border-stone-700"><th scope="row" className="py-3 pr-3 font-normal text-stone-300">{row.label}</th><td className="py-3 text-right tabular-nums">{row.refundPercent === 0 ? language === 'en' ? 'Non-refundable' : '환불 불가' : `${row.refundPercent}%`}</td></tr>)}</tbody></table> : <p className="text-sm leading-7 text-stone-300">{language === 'en' ? 'Please review the cancellation and refund terms on the payment page before paying.' : '결제 전 다음 화면에서 취소·환불 규정을 확인해 주세요.'}</p>}
        </div>
      </section>

      {property.status === 'coming_soon' ? (
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
          <div className={`${styles.calendar} bg-stone-900 border border-stone-700 rounded-xl sm:p-6 md:p-10`}>
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

            <div className="grid grid-cols-7 gap-y-1.5 text-center">
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
                        ? 'text-stone-300 hover:bg-stone-800 border border-dashed border-stone-500'
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
          <StayTourSelector propertyId={property.id} checkIn={checkIn ? format(checkIn, 'yyyy-MM-dd') : ''} checkOut={checkOut ? format(checkOut, 'yyyy-MM-dd') : ''} guests={guests} english={language === 'en'} selections={tourSelections} onChange={setTourSelections} />
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
              <div role="alert" className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl px-5 py-4">
                <p className="text-red-300 text-sm flex-1">{t(errorMessage)}</p>
                <button onClick={() => setErrorMessage(null)} className="flex min-h-11 min-w-11 items-center justify-center text-red-200 hover:text-red-100 transition-colors" aria-label={t("닫기")}>
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
                  <p className="text-xs text-stone-400 text-right">{language === 'en' ? `Base ${baseGuests} guests · Up to ${property.maxGuests} guests` : `기준 ${baseGuests}인 · 최대 ${property.maxGuests}인`}</p>
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
                    placeholder={language === 'en' ? 'Guest name' : '예약자 이름'}
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

              {checkIn && checkOut && checkoutMethods.length > 0 && <section aria-live="polite" className="border border-stone-700 p-5 space-y-2">
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
                {priceError && <div role="alert" className="text-sm text-amber-200"><p>{t(priceError)}</p><button type="button" className="min-h-11 underline underline-offset-4" onClick={() => setPriceRetry(value => value + 1)}>{language === 'en' ? 'Retry price lookup' : '요금 다시 확인'}</button></div>}
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
              {tourSelections.length > 0 && <div className="space-y-2 border-t border-stone-700 pt-4 text-sm text-stone-300"><p>{toursAlreadyRequested ? language === 'en' ? 'These tours were requested separately and will not be requested again during payment.' : '이미 별도로 문의한 투어입니다. 숙박 결제에서 중복 신청하지 않습니다.' : language === 'en' ? `${tourSelections.length} optional tour request(s). Tour fees are separate from this payment.` : `옵션 투어 ${tourSelections.length}개 신청 예정 · 투어 비용은 숙박 결제에 포함되지 않습니다.`}</p><a className="inline-flex min-h-11 items-center underline underline-offset-4" href="#stay-tours">{language === 'en' ? 'Review tour requests' : '선택한 투어 확인'}</a>{selectedTourIssue && <p role="alert" className="text-amber-300">{selectedTourIssue}</p>}</div>}
              {tourSelections.length > 0 && <fieldset className="space-y-4 rounded-md border border-stone-500 p-4">
                <legend className="px-2 text-sm">{language === 'en' ? 'Request tours separately' : '투어만 먼저 문의하기'}</legend>
                <p className="text-sm leading-6 text-stone-300">{language === 'en' ? 'Enter your planned stay dates and contact details. This sends a tour inquiry only and does not reserve accommodation. Tours are confirmed and paid for separately after a schedule check.' : '숙박 예정일과 연락처로 투어 문의만 먼저 보낼 수 있습니다. 숙박 예약은 완료되지 않으며, 투어는 일정 확인 후 별도 확정·결제를 안내합니다.'}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><label htmlFor="inquiry-check-in" className="mb-2 block text-sm">{language === 'en' ? 'Planned check-in' : '숙박 예정 체크인'}</label><input id="inquiry-check-in" className="min-h-12 w-full rounded-md border bg-stone-950 px-3 text-base" type="date" min={todayKst()} value={inquiryPayload.checkIn} onChange={event => setCheckIn(event.target.value ? new Date(`${event.target.value}T00:00:00`) : null)} /></div>
                  <div><label htmlFor="inquiry-check-out" className="mb-2 block text-sm">{language === 'en' ? 'Planned check-out' : '숙박 예정 체크아웃'}</label><input id="inquiry-check-out" className="min-h-12 w-full rounded-md border bg-stone-950 px-3 text-base" type="date" min={checkIn ? format(addDays(checkIn, 1), 'yyyy-MM-dd') : todayKst()} value={inquiryPayload.checkOut} onChange={event => setCheckOut(event.target.value ? new Date(`${event.target.value}T00:00:00`) : null)} /></div>
                </div>
                <p className="text-sm text-stone-400">{language === 'en' ? 'We will use the name and phone number entered above. Email is optional for a tour inquiry.' : '위에 입력한 이름·연락처로 안내합니다. 투어 문의만 보낼 때 이메일은 선택 사항입니다.'}</p>
                <button type="button" disabled={inquiryBusy || isSubmitting || toursAlreadyRequested} onClick={() => void submitTourInquiry()} className="min-h-12 w-full rounded-md border border-stone-400 px-3 py-3 text-sm disabled:opacity-50">{toursAlreadyRequested ? language === 'en' ? 'Tour request received' : '투어 문의 접수됨' : inquiryBusy ? language === 'en' ? 'Sending tour request…' : '투어 문의 접수 중…' : language === 'en' ? 'Send selected tour requests' : '선택한 투어 문의하기'}</button>
              </fieldset>}
              {inquiryReceipt && <div role="status" className="space-y-2 border border-stone-500 p-4 text-sm leading-6 text-stone-100"><p>{language === 'en' ? 'Your tour request has been received. Accommodation has not been reserved. Your host will contact you to confirm the tour schedule and arrange payment.' : '투어 문의가 접수되었습니다. 숙박 예약은 확정되지 않았습니다. 담당자가 투어 일정 확인 후 확정·결제를 안내합니다.'}</p><p className="break-all text-xs text-stone-300">{language === 'en' ? 'Request reference: ' : '문의번호: '}{inquiryReceipt.ids.join(', ')}</p>{!inquiryAlreadySent && <p className="text-stone-300">{language === 'en' ? 'These references belong to your previously submitted details. Changes above have not been sent.' : '위 문의번호는 앞서 접수한 내용입니다. 변경한 내용은 아직 전송되지 않았습니다.'}</p>}</div>}
              <a href="#stay-refund" className="flex min-h-11 items-center text-sm text-stone-200 underline underline-offset-4">{language === 'en' ? 'Review cancellation & refund policy' : '취소 및 환불 규정 확인'}</a>
              <button
                type="submit"
                disabled={!checkoutMethods.includes(gateway) || !checkIn || !checkOut || !name || !phone || !email || isSubmitting || inquiryBusy || !!selectedStayIssue || !!selectedTourIssue || !stayPrice || priceLoading || !!priceError}
                className={`
                  w-full py-5 rounded-full text-sm uppercase tracking-widest font-medium transition-all duration-500
                  ${checkoutMethods.includes(gateway) && checkIn && checkOut && name && phone && email && !selectedStayIssue && !selectedTourIssue && stayPrice && !priceLoading && !priceError
                    ? 'bg-stone-100 text-stone-900 hover:bg-stone-200'
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
      {getPropertyDisplay(property.slug || id)?.region === '북촌' && <section className={`${styles.lightSection} bg-[#f4f0e8] px-4 py-10 text-[#293d31] sm:px-6`}>
        <JongnoEventRecommendations start={checkIn ? format(checkIn, 'yyyy-MM-dd') : null} end={checkOut ? format(checkOut, 'yyyy-MM-dd') : null} language={language} className="mx-auto max-w-7xl" />
      </section>}
      {property.status !== 'coming_soon' && <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-stone-700 bg-stone-950/95 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="min-w-0 text-sm"><p className="truncate">{t(property.name)}</p><p className="mt-1 text-xs text-stone-400">{checkIn && checkOut ? format(checkIn, 'M.d') + ' ~ ' + format(checkOut, 'M.d') : language === 'en' ? 'Choose dates to view rates' : '날짜 선택 후 요금 확인'}</p></div>
        <a href="#calendar-selection" className="flex min-h-11 shrink-0 items-center rounded-lg bg-[#eee8dc] px-5 text-sm font-medium text-stone-950">{language === 'en' ? 'Dates & rates' : '날짜·요금 확인'}</a>
      </div>}
    </div>
  );
}
