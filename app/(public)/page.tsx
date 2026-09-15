'use client';

import { usePublicLanguage } from '@/components/PublicLanguage';
import { useEffect, useRef, useState } from 'react';
import { type StaySearch, type StaySearchResult, staySearchQuery } from '@/lib/stay-search';

import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight, MapPin, Users, Dog } from 'lucide-react';
import { ScrollUnfoldHero } from '@/components/ScrollUnfoldHero';
import { StayBookingSearch } from '@/components/StayBookingSearch';
import { Logo } from '@/components/Logo';
import { PROPERTY_DISPLAY, PROPERTY_DISPLAY_ORDER } from '@/lib/property-display';

export default function PublicPortal() {
  const { t, language } = usePublicLanguage();
  const en = language === 'en';
  const [search, setSearch] = useState<StaySearch | null>(null);
  const [results, setResults] = useState<StaySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => { controller.current?.abort(); controller.current = null; };
  }, []);
  async function findStays(criteria: StaySearch) {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setSearching(true); setSearchError(false); setSearch(criteria); setResults([]);
    const timeout = setTimeout(() => request.abort(), 60000);
    try {
      const response = await fetch('/api/public/stay-search', { method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(criteria) });
      if (!response.ok) throw new Error('Search unavailable');
      const data = await response.json();
      if (controller.current === request) setResults(data.results);
    } catch { if (controller.current === request) setSearchError(true); }
    finally {
      clearTimeout(timeout);
      if (controller.current === request) {
        setSearching(false);
        document.getElementById('spaces')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      }
    }
  }

  return (
    <div className="min-h-screen bg-[#171b18] text-stone-50 selection:bg-stone-400/20 font-sans">
      <a href="#find-stay" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-4 focus:z-[60] focus:bg-white focus:text-stone-900 focus:p-4">{t("숙소 예약으로 바로가기")}</a>

      <main>
      {/* Hero Section */}
      <ScrollUnfoldHero />
      <StayBookingSearch onSearch={findStays} loading={searching} />

      {/* Spaces Grid Section */}
      <section id="spaces" aria-labelledby="spaces-title" className="scroll-mt-20 py-16 md:py-24 px-6 md:px-12 max-w-[1480px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-10 md:mb-14">
          <div>
            <h2 id="spaces-title" className="brand-serif text-3xl md:text-5xl leading-relaxed">{t("머무는 공간")}</h2>
          </div>
        </div>
        <div aria-live="polite" className="mb-8 text-sm text-stone-300 space-y-3">
          {search ? <p>{search.checkIn} — {search.checkOut} · {search.guests}{en ? ' guests' : '명'} <button type="button" onClick={() => { controller.current?.abort(); controller.current = null; setSearching(false); setSearch(null); setResults([]); setSearchError(false); }} className="ml-4 min-h-11 underline">{en ? 'Clear search' : '전체 숙소 보기'}</button></p> : <p>{en ? 'From rates · 2 guests, per night. Final rates vary by date and options.' : '기준요금 · 2인 / 1박부터. 날짜와 옵션에 따라 최종 요금이 달라집니다.'}</p>}
          {searching && <p role="status">{en ? 'Checking live rates and availability…' : '실시간 요금과 예약 가능 여부를 확인하고 있습니다…'}</p>}
          {search && results.some(r => r.status === 'available' && !r.includesAllFees) && <p>{en ? 'Any additional mandatory fees will be confirmed at checkout.' : '별도 필수 요금이 있는 경우 결제 단계에서 확인할 수 있습니다.'}</p>}
          {searchError && <p role="alert">{en ? 'Some information could not be loaded. Please retry or check the stay details.' : '일부 정보를 불러오지 못했습니다. 다시 검색하거나 숙소 상세에서 확인해주세요.'}</p>}
          {search && !searching && !searchError && results.length > 0 && results.every(r => r.status === 'unavailable') && <p>{en ? 'No stays match these dates and guests. Please try another date.' : '선택한 날짜와 인원에 맞는 숙소가 없습니다. 다른 날짜로 검색해주세요.'}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-10 md:gap-y-14">
          {PROPERTY_DISPLAY_ORDER.filter(slug => PROPERTY_DISPLAY[slug]?.status !== 'closed').map((slug) => {
            const p = PROPERTY_DISPLAY[slug];
            if (!p) return null;
            const isComingSoon = p.status === 'coming_soon';
            const result = results.find(item => item.slug === p.slug);
            const hasImage = p.imageFiles.length > 0;
            const coverWebp = hasImage ? `/images/${p.imageFolder}/${p.imageFiles[0]}.webp` : null;
            return (
              <article key={slug} className="stay-reveal">
                <Link
                  href={`/book/${p.slug}${search && result?.status === 'available' ? `?${staySearchQuery(search)}` : ''}`}
                  className="group block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8c3a4]"
                >
                  <div className="relative overflow-hidden bg-stone-900 aspect-[3/2]">
                  {/* Cover image or placeholder */}
                  {coverWebp ? (
                      <Image
                        src={coverWebp}
                        alt={t(p.name)}
                        fill
                        sizes="(max-width: 767px) 100vw, (max-width: 1480px) 50vw, 700px"
                        className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none"
                      />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-stone-800 to-stone-950">
                      <span className="font-serif text-5xl md:text-6xl text-stone-700 tracking-tight">
                        {t(p.name).charAt(0)}
                      </span>
                    </div>
                  )}

                  {/* Coming soon badge */}
                  {isComingSoon && (
                    <div className="absolute top-4 left-4 z-10 bg-[#eee8dc] text-stone-900 text-sm px-3 py-2">
                      {t(p.openingLabel || 'Coming Soon')}
                    </div>
                  )}
                  </div>

                  <div className="pt-5 pb-5 border-b border-white/20">
                    <p className="flex items-center gap-2 text-sm text-[#d8c3a4] mb-3"><MapPin size={14} aria-hidden="true" />
                      {t(p.region)}
                    </p>
                    <div className="flex items-end justify-between gap-3">
                      <h3 className="text-2xl md:text-3xl font-light tracking-tight text-stone-50 leading-snug">
                        {t(p.name)}
                      </h3>
                      <ArrowUpRight
                        size={22}
                        className="text-stone-100 shrink-0 mb-1 opacity-70 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-300"
                      />
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-300 mt-4">
                      <span className="inline-flex items-center gap-2"><Users size={15} aria-hidden="true" />{en ? `Up to ${p.maxGuests} guests` : `최대 ${p.maxGuests}인`}</span>
                      {p.maxPets != null && <span className="inline-flex items-center gap-2"><Dog size={15} aria-hidden="true" />{p.maxPets > 0 ? (en ? `Up to ${p.maxPets} dogs` : `반려견 ${p.maxPets}마리 동반 가능`) : (en ? 'No dogs' : '반려견 동반 불가')}</span>}
                    </div>
                    <div className="flex justify-between items-end gap-4 mt-6 pt-5 border-t border-white/10">
                      <p className="text-xl text-stone-100">
                        {isComingSoon ? t('오픈 예정') : search ? searching ? (en ? 'Checking rates…' : '요금 확인 중…') : result?.status === 'available' ? `₩${result.priceKrw!.toLocaleString()}` : result?.status === 'unavailable' ? (en ? 'Unavailable for this search' : '선택 조건 예약 불가') : (en ? 'Rate unavailable · retry' : '요금 조회 실패 · 재검색') : (en ? 'From ₩300,000' : '30만원~')}
                        {!isComingSoon && (!search || result?.status === 'available') && <span className="block text-xs text-stone-400 mt-2">{search ? (en ? `${result?.nights} nights · ${result?.includesAllFees ? 'stay total' : 'stay rate'}, selected options included` : `${result?.nights}박 ${result?.includesAllFees ? '총요금' : '숙박요금'} · 선택 옵션 포함`) : (en ? '2 guests · per night' : '기준 2인 · 1박')}</span>}
                      </p>
                      <span className="text-sm text-[#d8c3a4] whitespace-nowrap">{en ? 'View stay' : '숙소 보기'}</span>
                    </div>
                  </div>
                </Link>
              </article>
            );
          })}
        </div>
      </section>
      </main>
      <section className="mx-6 mt-8 border-y border-stone-700 py-10 md:mx-12">
        <Link href="/guide" className="mx-auto flex max-w-6xl items-center justify-between gap-6">
          <div><p className="text-xs tracking-widest text-stone-400">BUKCHON GUIDE</p><h2 className="brand-serif mt-3 text-2xl">{language === 'en' ? 'Discover the neighborhood' : '북촌의 맛집, 투어, 여행지'}</h2><p className="mt-3 text-sm text-stone-400">{language === 'en' ? 'Find your next meal, walk and discovery.' : '머무는 동안 함께 즐길 동네의 장소들을 만나보세요.'}</p></div><ArrowUpRight aria-hidden="true" className="shrink-0" />
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-800 py-12 px-6 md:px-12 mt-20">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-start gap-8">
          <div className="space-y-5">
            <div className="opacity-80"><Logo width={120} /></div>
            <div className="text-xs leading-6 text-stone-400">
              <p>{en ? 'Company' : '회사명'} · 주식회사 운와</p>
              <p>{en ? 'Representative' : '대표자'} · 박도영</p>
              <p>{en ? 'Business registration number' : '사업자 등록번호'} · 743-86-03452</p>
            </div>
          </div>
          <div className="space-y-4 md:text-right">
            <a href="https://www.instagram.com/voidanchae/" target="_blank" rel="noopener noreferrer" aria-label={en ? 'VOID ANCHAE Instagram (opens in a new tab)' : 'VOID ANCHAE 인스타그램 (새 탭에서 열림)'} className="inline-flex items-center gap-2 min-h-11 text-sm text-stone-300 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4">
              Instagram <ArrowUpRight size={16} aria-hidden="true" />
            </a>
            <p className="text-xs tracking-wide text-stone-400">
              © {new Date().getFullYear()} VOID ANCHAE. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
