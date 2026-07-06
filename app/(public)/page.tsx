'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { motion } from 'motion/react';
import { Menu, X, ArrowUpRight } from 'lucide-react';
import { ScrollUnfoldHero } from '@/components/ScrollUnfoldHero';
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
    <div className="min-h-screen bg-[#0C0A09] text-stone-50 selection:bg-stone-400/20 font-sans">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-stone-950/55 backdrop-blur-md border-b border-white/[0.06]">
        <div className="flex justify-between items-center px-6 md:px-8 h-16 md:h-[72px]">
          <Link href="/" className="flex items-center hover:opacity-80 transition-opacity" aria-label="void anchae 홈" onClick={() => setMobileOpen(false)}>
            <Logo width={140} priority />
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-7 text-xs uppercase tracking-widest font-medium text-stone-300">
            {NAV_LINKS.map(link => (
              <Link key={link.href} href={link.href} className="hover:text-white transition-colors min-h-[44px] inline-flex items-center">
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-2">
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

          {/* Mobile: hamburger */}
          <div className="md:hidden flex items-center gap-2">
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

      {/* No-JS fallback for hero (cards rely on scroll-driven animation) */}
      <noscript>
        <style>{`
          [data-scroll-hero] { display: none !important; }
          [data-noscript-hero] { display: block !important; }
        `}</style>
      </noscript>

      <div data-noscript-hero style={{ display: 'none' }} className="pt-24 pb-16 px-6 text-center">
        <h1 className="text-4xl md:text-5xl font-light tracking-tight leading-tight mb-6">
          당신만의 특별한<br />머무름
        </h1>
        <p className="text-stone-300 max-w-xl mx-auto mb-8">
          북촌의 디자인 한옥 스테이. 정성스럽게 가꾼 공간으로 초대합니다.
        </p>
      </div>

      {/* Hero Section */}
      <ScrollUnfoldHero />

      {/* Spaces Grid Section */}
      <section id="spaces" className="py-24 px-6 md:px-12 max-w-[1600px] mx-auto border-t border-stone-800">
        <div className="flex flex-col items-center mb-16 md:mb-20">
          <p className="text-xs uppercase tracking-[0.3em] text-stone-400 mb-4">Bukchon Hanok Stay</p>
          <h2 className="text-4xl md:text-5xl font-light tracking-tight mb-4 text-center">VOID ANCHAE 공간</h2>
          <p className="text-sm text-stone-400 font-light tracking-wide text-center max-w-lg">
            북촌에서 만나는 다섯 개의 한옥. 하나의 이야기가 하나의 공간이 됩니다.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {PROPERTY_DISPLAY_ORDER.map((slug, idx) => {
            const p = PROPERTY_DISPLAY[slug];
            if (!p) return null;
            const isComingSoon = p.status === 'coming_soon';
            const hasImage = p.imageFiles.length > 0;
            const coverJpg = hasImage ? `/images/${p.imageFolder}/${p.imageFiles[0]}.jpg` : null;
            const coverWebp = hasImage ? `/images/${p.imageFolder}/${p.imageFiles[0]}.webp` : null;
            return (
              <motion.div
                key={slug}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.7, delay: idx * 0.05 }}
              >
                <Link
                  href={`/book/${p.slug}`}
                  className="group block relative overflow-hidden bg-stone-900 aspect-[4/5] rounded-2xl"
                >
                  {/* Cover image or placeholder */}
                  {coverJpg && coverWebp ? (
                    <picture>
                      <source srcSet={coverWebp} type="image/webp" />
                      <Image
                        src={coverJpg}
                        alt={p.name}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover transition-transform duration-1000 ease-out group-hover:scale-105"
                      />
                    </picture>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-stone-800 to-stone-950">
                      <span className="font-serif text-5xl md:text-6xl text-stone-700 tracking-tight">
                        {p.name.charAt(0)}
                      </span>
                    </div>
                  )}

                  {/* Gradient overlay for text legibility */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

                  {/* Coming soon badge */}
                  {isComingSoon && (
                    <div className="absolute top-4 left-4 z-10 bg-amber-500/90 text-black text-[10px] uppercase tracking-[0.2em] font-semibold px-3 py-1.5 rounded-full">
                      {p.openingLabel || 'Coming Soon'}
                    </div>
                  )}

                  {/* Card content — bottom */}
                  <div className="absolute inset-x-0 bottom-0 p-6 md:p-7 z-10">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-stone-300 mb-2 font-medium">
                      {p.region}
                    </p>
                    <div className="flex items-end justify-between gap-3">
                      <h3 className="font-serif text-3xl md:text-4xl font-light tracking-tight text-stone-50 leading-none">
                        {p.name}
                      </h3>
                      <ArrowUpRight
                        size={22}
                        className="text-stone-100 shrink-0 mb-1 opacity-70 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-300"
                      />
                    </div>
                    <p className="text-sm text-stone-300 font-light mt-2 tracking-wide">
                      {p.catchphrase}
                    </p>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </section>

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
