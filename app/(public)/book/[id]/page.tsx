'use client';

import { usePublicLanguage } from '@/components/PublicLanguage';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ArrowRight, Clock, Users as UsersIcon, X } from 'lucide-react';
import { format, addDays, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isBefore } from 'date-fns';
import { ko, enUS } from 'date-fns/locale';
import type { PropertyData } from '@/lib/types';
import type { StayOptions } from '@/lib/payments/stay-options';
import { todayKst } from '@/lib/dates';
import { arrivalIssue, stayIssue, type StayCalendar } from '@/lib/stay-calendar';

export default function BookPage() {
  const { id } = useParams() as { id: string };
  return <BookingContent key={id} />;
}

function BookingContent() {
  const { language, t } = usePublicLanguage();
  const { id } = useParams() as { id: string };
  const [property, setProperty] = useState<Omit<PropertyData, 'bookedDates'> | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentMonth, setCurrentMonth] = useState(new Date(`${todayKst()}T00:00:00`));
  const [checkIn, setCheckIn] = useState<Date | null>(null);
  const [checkOut, setCheckOut] = useState<Date | null>(null);

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

  const [guests, setGuests] = useState(2);
  const [pets, setPets] = useState(0);
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
  const [heroIndex, setHeroIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 갤러리 뷰어: 한 장씩 노출. 스크롤/화살표/스와이프로 넘김.
  const [viewerIndex, setViewerIndex] = useState(0);
  const viewerRef = useRef<HTMLDivElement>(null);
  const wheelLast = useRef(0);
  const viewerTouchStartX = useRef<number | null>(null);

  // 라이트박스 (갤러리 확대 뷰). null = 닫힘, index = 그 위치의 사진 표시
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const lightboxOpen = lightboxIndex !== null;
  const touchStartX = useRef<number | null>(null);


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

  // 갤러리 조작: 이전/다음/닫기 (뷰어 + 라이트박스가 공유)
  const galleryImages = property?.images && property.images.length > 0 ? property.images : [];
  const wrapIndex = (i: number) => galleryImages.length === 0 ? 0 : ((i % galleryImages.length) + galleryImages.length) % galleryImages.length;
  const gotoViewer = (i: number) => setViewerIndex(wrapIndex(i));
  const gotoLightbox = (i: number) => setLightboxIndex(wrapIndex(i));
  const closeLightbox = () => setLightboxIndex(null);

  // 마우스 휠 조작 — 뷰어 위에 커서가 있을 때만 한 장씩 넘김 (debounced).
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || galleryImages.length <= 1) return;
    const onWheel = (e: WheelEvent) => {
      const now = Date.now();
      // 디바운스 창(400ms) 안에서는 이벤트 흡수만 하고 넘기지 않음.
      if (now - wheelLast.current < 400) { e.preventDefault(); return; }
      // 수직/수평 중 큰 쪽을 방향으로 채택 (트랙패드 대비).
      const dy = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (Math.abs(dy) < 5) return;
      e.preventDefault();
      wheelLast.current = now;
      setViewerIndex((prev) => wrapIndex(prev + (dy > 0 ? 1 : -1)));
    };
    // React 의 onWheel 은 passive 리스너라 preventDefault 가 무시됨 → 직접 등록.
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryImages.length]);

  // 페이지 (지점) 전환 시 뷰어를 첫 사진으로 리셋.
  useEffect(() => { setViewerIndex(0); }, [id]);

  // 라이트박스 열려 있는 동안: 키보드 조작 + 배경 스크롤 잠금.
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') gotoLightbox((lightboxIndex ?? 0) - 1);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        gotoLightbox((lightboxIndex ?? 0) + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxOpen, lightboxIndex, galleryImages.length]);

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
    <div className="min-h-screen bg-[#0C0A09] text-stone-50 selection:bg-stone-400/20">

      {/* Hero Gallery Section */}
      {(() => {
        const galleryImages = property.images && property.images.length > 0
          ? property.images
          : [property.imageUrl || '/images/main_yard.webp'];
        return (
          <div className="relative h-[55svh] min-h-[360px] md:h-[65vh] w-full overflow-hidden group/hero">
            {galleryImages.map((src, i) => (
              <Image
                key={src}
                src={src}
                alt={`${t(property.name)} ${i + 1}`}
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
                  className="absolute left-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-black/30 backdrop-blur-sm border border-stone-800 text-stone-400 hover:text-stone-50 hover:bg-black/50 transition-all opacity-100 md:opacity-0 md:group-hover/hero:opacity-100 focus-visible:opacity-100"
                  aria-label={t("이전 이미지")}
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  onClick={() => setHeroIndex((heroIndex + 1) % galleryImages.length)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-black/30 backdrop-blur-sm border border-stone-800 text-stone-400 hover:text-stone-50 hover:bg-black/50 transition-all opacity-100 md:opacity-0 md:group-hover/hero:opacity-100 focus-visible:opacity-100"
                  aria-label={t("다음 이미지")}
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
                {property.region ? `${t(property.region)} · ` : ''}void anchae
              </p>
              <h1 className="font-serif text-5xl md:text-7xl lg:text-[100px] font-light tracking-tighter leading-none mb-6">
                {t(property.name)}
              </h1>
              {property.description && (
                <p className="text-stone-400 text-sm md:text-base font-light max-w-lg leading-relaxed">
                  {t(property.description)}
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Property Info Bar */}
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-sm text-stone-400 border-b border-stone-800">
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
            <span>{t("최대")}{property.maxGuests}{t("인")}</span>
          </div>
        )}
      </div>

      {property.status !== 'coming_soon' && (
        <div className="lg:hidden px-4 pt-6">
          <a href="#booking-dates" className="flex min-h-12 items-center justify-center gap-3 rounded-xl bg-[#eee8dc] px-5 py-3 text-sm font-medium text-stone-950">{t("날짜 · 요금 확인")}<ArrowRight size={16} />
          </a>
        </div>
      )}

      {/* Photo Gallery Viewer — 한 장씩 넘기는 뷰어. 사진이 1장 초과일 때만. */}
      {galleryImages.length > 1 && (
        <section className="max-w-6xl mx-auto px-4 md:px-6 py-10 md:py-20">
          <div className="flex items-baseline justify-between mb-8 md:mb-10">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-stone-400 mb-3 font-semibold">Gallery</p>
              <h2 className="font-serif text-3xl md:text-4xl font-light tracking-tight text-stone-100">{t("공간")}</h2>
            </div>
            <p className="text-xs text-stone-500 tracking-widest tabular-nums">
              {viewerIndex + 1} / {galleryImages.length}
            </p>
          </div>

          <div
            ref={viewerRef}
            className="relative w-full aspect-[4/3] md:aspect-[16/10] bg-stone-900 overflow-hidden select-none"
            onTouchStart={(e) => { viewerTouchStartX.current = e.touches[0]?.clientX ?? null; }}
            onTouchEnd={(e) => {
              const startX = viewerTouchStartX.current;
              viewerTouchStartX.current = null;
              if (startX == null) return;
              const endX = e.changedTouches[0]?.clientX ?? startX;
              const delta = endX - startX;
              if (delta > 50) gotoViewer(viewerIndex - 1);
              else if (delta < -50) gotoViewer(viewerIndex + 1);
            }}
          >
            {/* 모든 사진을 미리 렌더 (opacity 만 토글) → 넘길 때 로딩 지연 없음.
                object-cover 로 컨테이너에 꽉 채움. */}
            {galleryImages.map((src, i) => (
              <Image
                key={`viewer-${src}`}
                src={src}
                alt={`${t(property.name)} ${i + 1}`}
                fill
                sizes="(max-width: 1024px) 100vw, 1200px"
                className={`object-cover transition-opacity duration-700 ease-in-out ${
                  i === viewerIndex ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
                priority={i === 0}
              />
            ))}

            {/* 사진 클릭 → 라이트박스 확대. 화살표 버튼은 z-index 로 이 위에. */}
            <button
              type="button"
              onClick={() => gotoLightbox(viewerIndex)}
              className="absolute inset-0 z-10 cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-stone-100 focus:ring-inset"
              aria-label={t("크게 보기")}
            />

            {/* 이전/다음 */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); gotoViewer(viewerIndex - 1); }}
              className="absolute left-3 md:left-5 top-1/2 -translate-y-1/2 z-20 p-3 md:p-3.5 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-sm border border-stone-700 text-stone-100 hover:text-white transition-colors"
              aria-label={t("이전 사진")}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); gotoViewer(viewerIndex + 1); }}
              className="absolute right-3 md:right-5 top-1/2 -translate-y-1/2 z-20 p-3 md:p-3.5 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-sm border border-stone-700 text-stone-100 hover:text-white transition-colors"
              aria-label={t("다음 사진")}
            >
              <ChevronRight size={20} />
            </button>
          </div>

          {/* 진행 표시 dots — 사진 개수가 많으면 축소 표시. */}
          <div className="flex items-center justify-center gap-1.5 mt-6 flex-wrap">
            {galleryImages.map((_, i) => (
              <button
                key={`dot-${i}`}
                type="button"
                onClick={() => gotoViewer(i)}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === viewerIndex ? 'bg-stone-100 w-8' : 'bg-stone-100/25 hover:bg-stone-100/60 w-1.5'
                }`}
                aria-label={language === 'en' ? `View photo ${i + 1}` : `${i + 1}번 사진으로 이동`}
              />
            ))}
          </div>

          <p className="text-center text-xs text-stone-400 mt-4">{t("좌우로 밀어 넘기기 · 사진을 누르면 크게 보기")}</p>
        </section>
      )}

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
      <div id="booking-dates" className="scroll-mt-24 max-w-5xl mx-auto px-4 md:px-6 py-10 md:py-24 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20">

        {/* Left: Calendar */}
        <div className="lg:col-span-7 space-y-8">
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
          <div className="lg:sticky lg:top-24 space-y-8">
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

              <a href="#booking-dates" className="inline-flex min-h-11 items-center text-sm text-stone-300 underline underline-offset-4">{t("날짜 다시 선택")}</a>

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
                  <p className="text-xs text-stone-600 text-right">{t("최대")}{property.maxGuests}{t("인")}</p>
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

      {/* Lightbox — 그리드 썸네일 클릭 시 확대 */}
      {lightboxOpen && galleryImages.length > 0 && (
        <div
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={`${t(property.name)} — ${t("크게 보기")}`}
          onClick={closeLightbox}
          onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null; }}
          onTouchEnd={(e) => {
            const startX = touchStartX.current;
            touchStartX.current = null;
            if (startX == null) return;
            const endX = e.changedTouches[0]?.clientX ?? startX;
            const delta = endX - startX;
            if (delta > 50) gotoLightbox((lightboxIndex ?? 0) - 1);
            else if (delta < -50) gotoLightbox((lightboxIndex ?? 0) + 1);
          }}
        >
          {/* 실제 이미지 컨테이너 — 배경 클릭으로 닫히도록 stopPropagation */}
          <div
            className="relative w-full h-full flex items-center justify-center px-2 sm:px-16 py-16"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative w-full max-w-[1600px] h-full">
              <Image
                key={`lightbox-${lightboxIndex}`}
                src={galleryImages[lightboxIndex!]}
                alt={`${t(property.name)} ${lightboxIndex! + 1}`}
                fill
                sizes="100vw"
                className="object-contain"
                priority
              />
            </div>

            {/* 좌우 네비게이션 */}
            {galleryImages.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); gotoLightbox(lightboxIndex! - 1); }}
                  className="absolute left-3 md:left-6 top-1/2 -translate-y-1/2 z-10 p-3 md:p-4 rounded-full bg-black/40 hover:bg-white/10 backdrop-blur-md border border-stone-800 text-stone-200 hover:text-white transition-colors"
                  aria-label={t("이전 사진")}
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); gotoLightbox(lightboxIndex! + 1); }}
                  className="absolute right-3 md:right-6 top-1/2 -translate-y-1/2 z-10 p-3 md:p-4 rounded-full bg-black/40 hover:bg-white/10 backdrop-blur-md border border-stone-800 text-stone-200 hover:text-white transition-colors"
                  aria-label={t("다음 사진")}
                >
                  <ChevronRight size={22} />
                </button>
              </>
            )}
          </div>

          {/* 상단바: 카운터 + 닫기 */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 md:px-8 py-4 md:py-5 pointer-events-none">
            <p className="text-xs md:text-sm tracking-[0.25em] uppercase text-stone-300 font-medium pointer-events-auto">
              {(lightboxIndex ?? 0) + 1} / {galleryImages.length}
            </p>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
              className="p-2.5 rounded-full bg-black/40 hover:bg-white/10 backdrop-blur-md border border-stone-800 text-stone-200 hover:text-white transition-colors pointer-events-auto"
              aria-label={t("닫기")}
            >
              <X size={20} />
            </button>
          </div>

          {/* 하단 힌트 (데스크톱만) */}
          <div className="hidden md:block absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-widest text-stone-500 pointer-events-none">{t("← → 이동 · ESC 닫기")}</div>
        </div>
      )}
    </div>
  );
}
