'use client';

import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { Logo } from '@/components/Logo';

// VOID ANCHAE 브랜드 페이지 — 시(詩)적 흐름의 한 페이지.
// 상단 메뉴 → Hero (로고) → 브랜드 이야기 → 마무리 한 줄 → CTA → 푸터.

// 시적 구절을 문단(연) 단위로 배치. 각 연은 스크롤 진입 시 페이드인.
const STANZAS: string[][] = [
  [
    '대문을 지나 안으로 들어오면',
    '말소리는 낮아지고, 걸음은 느려집니다.',
  ],
  [
    '이곳에서는 무언가를 하지 않아도 괜찮습니다.',
    '그저 머무르는 것만으로 충분합니다.',
  ],
  [
    'VOID ANCHAE는 편안함의 이유를',
    '공간의 크기나 장식보다',
    '비워 둔 여백에서 찾았습니다.',
  ],
  [
    '당신이 들어와야 비로소 완성되는 공간.',
    '머무는 동안의 시간과 마음이',
    '자연스럽게 스며드는 한옥입니다.',
  ],
  [
    '서두르지 않아도 좋습니다.',
    '가장 나다운 모습으로 쉬어갈 수 있도록',
    '당신의 자리를 비워 두겠습니다.',
  ],
];

export default function BrandPage() {

  return (
    <div className="min-h-screen bg-[#0C0A09] text-stone-50 selection:bg-stone-400/20 font-sans overflow-x-hidden">
      {/* ═══ 상단 네비게이션 ═══ */}

      {/* ═══ HERO — 로고 + 그저 머물러도 충분한 곳 ═══ */}
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
            Seoul · Yeongju · Hanok Stay
          </p>

          <Image
            src="/voidanche_fin_white.png"
            alt="VOID ANCHAE"
            width={720}
            height={83}
            priority
            className="w-[260px] sm:w-[360px] md:w-[500px] lg:w-[600px] h-auto"
          />

          <p className="brand-serif text-stone-300 text-base md:text-xl mt-12 md:mt-14">
            그저 머물러도 충분한 곳
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

      {/* ═══ 본문 (브랜드 이야기) ═══ */}
      <section className="relative py-32 md:py-48 px-6 border-t border-stone-800/60">
        <div className="max-w-2xl mx-auto space-y-20 md:space-y-28 text-center">
          {STANZAS.map((lines, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
              className="brand-serif text-[18px] sm:text-[22px] md:text-[26px] leading-[2.2] text-stone-200 space-y-2"
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
          <p className="brand-serif text-[28px] sm:text-4xl md:text-5xl lg:text-6xl leading-[1.7] text-stone-100">
            당신이 들어와야<br />
            비로소 완성되는 공간.
          </p>

          <div className="mt-14 md:mt-16 flex flex-col items-center gap-6">
            <p className="text-stone-400 text-sm md:text-base font-light">
              당신이 머무는 한옥, VOID ANCHAE
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
