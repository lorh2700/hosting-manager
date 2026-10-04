'use client';

import { usePublicLanguage } from '@/components/PublicLanguage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type StaySearch, type StaySearchResult, staySearchQuery } from '@/lib/stay-search';
import { parsePublicStayCards, parsePublicStayResults, visiblePublicStays, type PublicStayCard } from '@/lib/public-home-stays';

import { NavigationLink as Link } from '@/components/NavigationFeedback';
import Image from 'next/image';
import { ArrowUpRight, MapPin, Users, Dog } from 'lucide-react';
import { ScrollUnfoldHero } from '@/components/ScrollUnfoldHero';
import { StayBookingSearch } from '@/components/StayBookingSearch';
import { Logo } from '@/components/Logo';

export default function PublicPortal() {
  const { t, language } = usePublicLanguage();
  const en = language === 'en';
  const [search, setSearch] = useState<StaySearch | null>(null);
  const [results, setResults] = useState<StaySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [cards, setCards] = useState<PublicStayCard[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const listController = useRef<AbortController | null>(null);
  const controller = useRef<AbortController | null>(null);
  const loadCards = useCallback(async () => {
    listController.current?.abort();
    const request = new AbortController();
    listController.current = request;
    setListLoading(true); setListError(false);
    const timeout = setTimeout(() => request.abort(), 15_000);
    try {
      const response = await fetch('/api/public/properties', { signal: request.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Property list unavailable');
      const listings = parsePublicStayCards(await response.json());
      if (!listings) throw new Error('Invalid property list');
      if (listController.current === request) setCards(listings);
    } catch {
      if (listController.current === request) setListError(true);
    } finally {
      clearTimeout(timeout);
      if (listController.current === request) setListLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadCards();
    return () => { listController.current?.abort(); listController.current = null; };
  }, [loadCards]);
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
      const searchResults = parsePublicStayResults(await response.json());
      if (!searchResults) throw new Error('Invalid availability response');
      if (controller.current === request) setResults(searchResults);
    } catch { if (controller.current === request) setSearchError(true); }
    finally {
      clearTimeout(timeout);
      if (controller.current === request) {
        setSearching(false);
        document.getElementById('spaces')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      }
    }
  }

  const visibleCards = visiblePublicStays(cards, { active: !!search, loading: searching, failed: searchError, results });
  const availableCount = visibleCards.filter(card => results.some(result => result.slug === card.slug && result.status === 'available')).length;
  const hasSearchErrors = searchError || (!!search && !searching && cards.some(card => card.status === 'active'
    && !results.some(result => result.slug === card.slug && result.status !== 'error')));

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
          {search ? <p>{search.checkIn} — {search.checkOut} · {search.guests}{en ? ' guests' : '명'} <button type="button" onClick={() => { controller.current?.abort(); controller.current = null; setSearching(false); setSearch(null); setResults([]); setSearchError(false); }} className="ml-4 min-h-11 underline">{en ? 'Clear search' : '전체 숙소 보기'}</button></p> : <p>{en ? 'Select dates to see live rates. Listed starting rates are for 2 guests per night.' : '날짜를 선택하면 실시간 요금을 확인할 수 있습니다. 표시된 기준요금은 2인 / 1박 기준입니다.'}</p>}
          {listLoading && <p role="status">{en ? 'Loading stays…' : '숙소 목록을 불러오고 있습니다…'}</p>}
          {listError && <p role="alert">{en ? 'The stay list could not be loaded. Please try again.' : '숙소 목록을 불러오지 못했습니다. 다시 시도해주세요.'} <button type="button" onClick={() => void loadCards()} className="ml-3 min-h-11 underline">{en ? 'Reload stays' : '숙소 다시 불러오기'}</button></p>}
          {!listLoading && !listError && cards.length === 0 && <p>{en ? 'No stays are currently published.' : '현재 공개된 숙소가 없습니다.'}</p>}
          {searching && <p role="status">{en ? 'Checking live rates and availability…' : '실시간 요금과 예약 가능 여부를 확인하고 있습니다…'}</p>}
          {search && results.some(r => r.status === 'available' && !r.includesAllFees) && <p>{en ? 'Any additional mandatory fees will be confirmed at checkout.' : '별도 필수 요금이 있는 경우 결제 단계에서 확인할 수 있습니다.'}</p>}
          {search && !searching && hasSearchErrors && <p role="alert">{en ? 'Some rates and availability could not be confirmed. You can still view the stays and check again.' : '일부 숙소의 요금과 예약 가능 여부를 확인하지 못했습니다. 숙소 소개를 보거나 다시 검색해주세요.'} <button type="button" onClick={() => findStays(search)} className="ml-3 min-h-11 underline">{en ? 'Retry search' : '다시 검색'}</button></p>}
          {search && !listLoading && !listError && cards.length > 0 && !searching && !hasSearchErrors && visibleCards.length === 0 && <p>{en ? 'No stays match these dates and guests. Please try another date or guest count.' : '선택한 날짜와 인원에 체크인 가능한 지점이 없습니다. 날짜나 인원을 변경해 검색해주세요.'}</p>}
          {search && !searching && availableCount > 0 && <p>{en ? `${availableCount} stays confirmed available for your dates and guests.` : `선택한 날짜와 인원에 예약 가능한 것으로 확인된 지점 ${availableCount}곳입니다.`}</p>}
        </div>

        <div aria-busy={listLoading || searching} className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-10 md:gap-y-14">
          {listLoading && cards.length === 0 && Array.from({ length: 6 }, (_, index) => <div key={index} aria-hidden="true" className="motion-safe:animate-pulse"><div className="aspect-[3/2] bg-white/5" /><div className="mt-5 h-6 w-1/3 bg-white/5" /><div className="mt-4 h-4 w-1/2 bg-white/5" /></div>)}
          {visibleCards.map((p) => {
            if (!p) return null;
            const isComingSoon = p.status === 'coming_soon';
            const result = results.find(item => item.slug === p.slug);
            const coverWebp = p.images[0] || null;
            return (
              <article key={p.slug} className="stay-reveal">
                <Link
                  href={`/book/${p.slug}${search && p.status === 'active' ? `?${staySearchQuery(search)}` : ''}`}
                  className="group block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8c3a4]"
                >
                  <div className="relative overflow-hidden bg-stone-900 aspect-[3/2]">
                  {/* Cover image or placeholder */}
                  {coverWebp ? (
                      <Image
                        src={coverWebp}
                        unoptimized={coverWebp.startsWith('https://')}
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
                        {isComingSoon ? t('오픈 예정') : search ? searching ? (en ? 'Checking rates…' : '요금 확인 중…') : result?.status === 'available' ? `₩${result.priceKrw!.toLocaleString()}` : (en ? 'Rates and availability unconfirmed' : '요금·예약 가능 여부 확인 필요') : p.basePrice ? (en ? `From ₩${p.basePrice.toLocaleString()}` : `₩${p.basePrice.toLocaleString()}부터`) : (en ? 'Select dates for rates' : '날짜 선택 후 요금 확인')}
                        {!isComingSoon && ((!search && !!p.basePrice) || result?.status === 'available') && <span className="block text-xs text-stone-400 mt-2">{search ? (en ? `${result?.nights} nights · ${result?.includesAllFees ? 'stay total' : 'stay rate'}, selected options included` : `${result?.nights}박 ${result?.includesAllFees ? '총요금' : '숙박요금'} · 선택 옵션 포함`) : (en ? '2 guests · per night' : '기준 2인 · 1박')}</span>}
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
