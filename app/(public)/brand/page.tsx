'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { Logo } from '@/components/Logo';

// VOID ANCHAE 브랜드 페이지 — 시(詩)적 흐름의 한 페이지.
// 상단 메뉴 → Hero (로고) → 4-연 본문 → 마무리 한 줄 → CTA → 푸터.

const NAV_LINKS = [
  { href: '/brand', label: '브랜드' },
  { href: '/#spaces', label: '공간' },
  { href: '/tours', label: '투어' },
  { href: '/about', label: '호스팅 지원 플랫폼' },
];

const SECONDARY_LINKS = [
  { href: 'https://lab.voidanchae.com', label: 'Lab', external: true },
];

// 시적 구절을 문단(연) 단위로 배치. 각 연은 스크롤 진입 시 페이드인.
const STANZAS: string[][] = [
  [
    '한옥의 가장 깊은 곳, 안채.',
    '대문을 지나 안채에 이르는 동안',
    '세상의 소음은 멀어지고, 몸의 긴장은 옅어집니다.',
  ],
  [
    'VOID ANCHAE는 그 깊은 고요를',
    '오늘의 감각으로 다시 지은 한옥 스테이입니다.',
  ],
  [
    '우리는 채우지 않습니다.',
    '당신이 들어올 자리를 남겨둘 뿐입니다.',
  ],
  [
    '햇살과 바람, 그리고 당신의 숨소리로',
    '비로소 완성되는 공간 —',
  ],
];

export default function BrandPage() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#0C0A09] text-stone-50 selection:bg-stone-400/20 font-sans overflow-x-hidden">
      {/* ═══ 상단 네비게이션 ═══ */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-stone-950/55 backdrop-blur-md border-b border-white/[0.06]">
        <div className="flex justify-between items-center px-6 md:px-8 h-16 md:h-[72px]">
          <Link
            href="/"
            className="flex items-center hover:opacity-80 transition-opacity"
            aria-label="void anchae 홈"
            onClick={() => setMobileOpen(false)}
          >
            <Logo width={140} priority />
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-7 text-xs uppercase tracking-widest font-medium text-stone-300">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hover:text-white transition-colors min-h-[44px] inline-flex items-center"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-2">
            {SECONDARY_LINKS.map((link) =>
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
              ),
            )}
          </div>

          {/* Mobile hamburger */}
          <div className="md:hidden flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
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
            {NAV_LINKS.map((link) => (
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
              {SECONDARY_LINKS.map((link) =>
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
                ),
              )}
            </div>
          </div>
        )}
      </nav>

      {/* ═══ HERO — 로고 + Deepest Rest ═══ */}
      <section className="relative min-h-screen w-full flex flex-col items-center justify-center px-6 pt-24">
        <Image
          src="/images/main_yard.webp"
          alt=""
          fill
          priority
          className="object-cover opacity-25 mix-blend-luminosity"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0C0A09] via-transparent to-[#0C0A09]" />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 flex flex-col items-center text-center"
        >
          <p className="text-[10px] uppercase tracking-[0.35em] text-stone-400 mb-10 md:mb-14 font-semibold">
            Bukchon · Hanok Stay
          </p>

          <Image
            src="/voidanche_fin_white.png"
            alt="VOID ANCHAE"
            width={720}
            height={83}
            priority
            className="w-[260px] sm:w-[360px] md:w-[500px] lg:w-[600px] h-auto"
          />

          <p className="text-stone-300 text-sm md:text-base font-light tracking-[0.3em] mt-12 md:mt-14 uppercase">
            Deepest Rest
          </p>
        </motion.div>

        {/* 스크롤 힌트 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2, duration: 1 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-10"
        >
          <span className="text-[10px] uppercase tracking-[0.3em] text-stone-500">scroll</span>
          <div className="w-px h-16 bg-gradient-to-b from-stone-600 to-transparent" />
        </motion.div>
      </section>

      {/* ═══ 본문 (시적 4연) ═══ */}
      <section className="relative py-32 md:py-48 px-6 border-t border-stone-800/60">
        <div className="max-w-2xl mx-auto space-y-20 md:space-y-28 text-center">
          {STANZAS.map((lines, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
              className="font-serif text-[22px] sm:text-2xl md:text-[28px] font-light leading-[2] tracking-wide text-stone-200 space-y-1"
            >
              {lines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </motion.div>
          ))}
        </div>
      </section>

      {/* ═══ 마무리 한 줄 + CTA ═══ */}
      <section className="relative min-h-[70vh] flex flex-col items-center justify-center px-6 py-32 border-t border-stone-800/60">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          className="text-center"
        >
          <p className="font-serif text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-light tracking-tight leading-[1.25] text-stone-100">
            비워진 곳에,<br />
            비로소 당신이 머뭅니다.
          </p>

          <div className="mt-14 md:mt-16 flex flex-col items-center gap-6">
            <p className="text-stone-400 text-sm md:text-base tracking-[0.3em] uppercase font-light">
              가장 깊은 안식, VOID ANCHAE
            </p>
            <Link
              href="/#spaces"
              className="inline-flex items-center gap-3 mt-6 px-9 py-4 border border-stone-700 rounded-full text-[11px] uppercase tracking-[0.25em] text-stone-100 hover:bg-stone-100 hover:text-stone-900 hover:border-stone-100 transition-colors duration-500"
            >
              공간 둘러보기
              <ArrowRight size={16} />
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-800 py-14 px-6 md:px-12">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <Link href="/" className="opacity-80 hover:opacity-100 transition-opacity">
            <Logo width={120} />
          </Link>
          <div className="text-[10px] uppercase tracking-widest text-stone-500">
            © {new Date().getFullYear()} void anchae. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
