'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { Menu, X, ArrowUpRight } from 'lucide-react';
import { ScrollUnfoldHero } from '@/components/ScrollUnfoldHero';
import { StayBookingSearch } from '@/components/StayBookingSearch';
import { Logo } from '@/components/Logo';
import { PROPERTY_DISPLAY, PROPERTY_DISPLAY_ORDER } from '@/lib/property-display';

const NAV_LINKS = [
  { href: '/brand', label: '브랜드' },
  { href: '#spaces', label: '공간' },
  { href: '/tours', label: '투어' },
  { href: '/about', label: '호스팅 지원 플랫폼' },
];

const SECONDARY_LINKS = [
  { href: 'https://lab.voidanchae.com', label: 'Lab', external: true },
  { href: '/admin', label: '관리자', external: false },
];

export default function PublicPortal() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#171b18] text-stone-50 selection:bg-stone-400/20 font-sans">
      <a href="#find-stay" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-4 focus:z-[60] focus:bg-white focus:text-stone-900 focus:p-4">숙소 예약으로 바로가기</a>
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-stone-950/55 backdrop-blur-md border-b border-white/[0.06]">
        <div className="flex justify-between items-center gap-3 px-4 sm:px-6 md:px-8 h-16 md:h-[72px]">
          <Link href="/" className="flex items-center shrink-0 max-[360px]:w-[120px] hover:opacity-80 transition-opacity" aria-label="void anchae 홈" onClick={() => setMobileOpen(false)}>
            <Logo width={140} priority />
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-5 text-sm font-medium text-stone-300">
            {NAV_LINKS.map(link => (
              <Link key={link.href} href={link.href} className="hover:text-white transition-colors min-h-[44px] inline-flex items-center">
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-2">
            <Link href="#find-stay" className="inline-flex items-center min-h-[44px] px-5 bg-[#eee8dc] text-stone-900 text-sm">예약하기</Link>
            {SECONDARY_LINKS.map(link => (
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs uppercase tracking-widest font-medium text-stone-200 bg-white/5 hover:bg-white/15 px-4 py-3 rounded-full transition-colors min-h-[44px] inline-flex items-center"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-xs uppercase tracking-widest font-medium text-stone-200 bg-white/5 hover:bg-white/15 px-4 py-3 rounded-full transition-colors min-h-[44px] inline-flex items-center"
                >
                  {link.label}
                </Link>
              )
            ))}
          </div>

          {/* Mobile: direct access to available spaces */}
          <div className="md:hidden flex items-center gap-2 shrink-0">
            <Link href="#spaces" onClick={() => setMobileOpen(false)} className="min-h-[44px] inline-flex items-center whitespace-nowrap px-3 text-xs text-stone-100 border border-white/25">공간 · 예약</Link>
            <button
              type="button"
              onClick={() => setMobileOpen(v => !v)}
              aria-label={mobileOpen ? '메뉴 닫기' : '메뉴 열기'}
              aria-expanded={mobileOpen}
              className="p-3 -mr-2 text-stone-200 hover:text-white min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* Mobile menu panel */}
        {mobileOpen && (
          <div className="md:hidden border-t border-white/[0.06] bg-stone-950/95 backdrop-blur-lg px-6 py-4 space-y-1">
            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block py-3 text-sm uppercase tracking-widest text-stone-200 hover:text-white min-h-[44px]"
              >
                {link.label}
              </Link>
            ))}
            <div className="border-t border-white/[0.06] pt-2 mt-2 space-y-1">
              {SECONDARY_LINKS.map(link => (
                link.external ? (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMobileOpen(false)}
                    className="block py-3 text-sm uppercase tracking-widest text-stone-300 hover:text-white min-h-[44px]"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    className="block py-3 text-sm uppercase tracking-widest text-stone-300 hover:text-white min-h-[44px]"
                  >
                    {link.label}
                  </Link>
                )
              ))}
            </div>
          </div>
        )}
      </nav>

      <main>
      {/* Hero Section */}
      <ScrollUnfoldHero />
      <StayBookingSearch />

      {/* Spaces Grid Section */}
      <section id="spaces" aria-labelledby="spaces-title" className="scroll-mt-20 py-16 md:py-24 px-6 md:px-12 max-w-[1480px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-10 md:mb-14">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-[#d8c3a4] mb-5">The Hanok Collection</p>
            <h2 id="spaces-title" className="text-3xl md:text-5xl font-light tracking-tight leading-snug">서로 다른 집,<br className="md:hidden" /> 나에게 맞는 쉼.</h2>
          </div>
          <p className="text-base text-stone-300 leading-7 max-w-sm break-keep">마당의 빛, 나무의 결, 골목의 풍경.<br />마음이 가는 공간에서 여행을 시작하세요.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-10 md:gap-y-14">
          {PROPERTY_DISPLAY_ORDER.filter(slug => PROPERTY_DISPLAY[slug]?.status !== 'closed').map((slug) => {
            const p = PROPERTY_DISPLAY[slug];
            if (!p) return null;
            const isComingSoon = p.status === 'coming_soon';
            const hasImage = p.imageFiles.length > 0;
            const coverWebp = hasImage ? `/images/${p.imageFolder}/${p.imageFiles[0]}.webp` : null;
            return (
              <article key={slug}>
                <Link
                  href={`/book/${p.slug}`}
                  className="group block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8c3a4]"
                >
                  <div className="relative overflow-hidden bg-stone-900 aspect-[3/2]">
                  {/* Cover image or placeholder */}
                  {coverWebp ? (
                      <Image
                        src={coverWebp}
                        alt={p.name}
                        fill
                        sizes="(max-width: 767px) 100vw, (max-width: 1480px) 50vw, 700px"
                        className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none"
                      />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-stone-800 to-stone-950">
                      <span className="font-serif text-5xl md:text-6xl text-stone-700 tracking-tight">
                        {p.name.charAt(0)}
                      </span>
                    </div>
                  )}

                  {/* Coming soon badge */}
                  {isComingSoon && (
                    <div className="absolute top-4 left-4 z-10 bg-[#eee8dc] text-stone-900 text-sm px-3 py-2">
                      {p.openingLabel || 'Coming Soon'}
                    </div>
                  )}
                  </div>

                  <div className="pt-5 pb-5 border-b border-white/20">
                    <p className="text-xs tracking-[0.15em] text-[#d8c3a4] mb-3">
                      {p.region}
                    </p>
                    <div className="flex items-end justify-between gap-3">
                      <h3 className="text-2xl md:text-3xl font-light tracking-tight text-stone-50 leading-snug">
                        {p.name}
                      </h3>
                      <ArrowUpRight
                        size={22}
                        className="text-stone-100 shrink-0 mb-1 opacity-70 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-300"
                      />
                    </div>
                    <p className="text-base text-stone-300 font-light mt-2 leading-7">
                      {p.catchphrase}
                    </p>
                    <p className="text-sm text-[#e2ceb0] mt-5">{isComingSoon ? '공간 소식 보기' : '공간 · 날짜 · 요금 확인'}</p>
                  </div>
                </Link>
              </article>
            );
          })}
        </div>
      </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-800 py-12 px-6 md:px-12 mt-20">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="opacity-80">
            <Logo width={120} />
          </div>
          <div className="text-xs uppercase tracking-widest text-stone-400">
            © {new Date().getFullYear()} void anchae. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
