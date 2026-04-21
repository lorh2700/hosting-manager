'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { ScrollUnfoldHero } from '@/components/ScrollUnfoldHero';
import { Logo } from '@/components/Logo';

export default function PublicPortal() {

  return (
    <div className="min-h-screen bg-[#0C0A09] text-stone-50 selection:bg-stone-400/20 font-sans">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center px-8 py-6 mix-blend-difference">
        <Link href="/" className="flex items-center hover:opacity-70 transition-opacity" aria-label="void anchae 홈">
          <Logo width={140} priority />
        </Link>
        <div className="hidden md:flex items-center gap-8 text-xs uppercase tracking-widest font-medium text-stone-400">
          <Link href="#spaces" className="hover:text-stone-50 transition-colors">공간</Link>
        </div>
        <div className="flex items-center gap-3">
          <a href="https://lab.voidanchae.com" target="_blank" rel="noopener noreferrer" className="text-xs uppercase tracking-widest font-medium border border-stone-700 px-4 py-2 rounded-full hover:bg-stone-50 hover:text-stone-900 transition-colors">
            Lab
          </a>
          <Link href="/admin" className="text-xs uppercase tracking-widest font-medium border border-stone-700 px-4 py-2 rounded-full hover:bg-stone-50 hover:text-stone-900 transition-colors">
            호스트
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <ScrollUnfoldHero />

      {/* Spaces Grid Section */}
      <section id="spaces" className="py-24 px-6 md:px-12 max-w-[1600px] mx-auto border-t border-stone-800">
        <div className="flex flex-col items-center mb-16">
          <p className="text-xs uppercase tracking-[0.3em] text-stone-500 mb-4">영감과 아이디어</p>
          <h2 className="text-4xl md:text-5xl font-light tracking-tight mb-16">VOID ANCHAE 공간</h2>

        </div>

        <div className="py-32 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <p className="text-xs uppercase tracking-[0.3em] text-stone-500 mb-6">Coming Soon</p>
            <p className="text-stone-500 font-light tracking-wide">
              공간 소개를 준비 중입니다.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-800 py-12 px-6 md:px-12 mt-20">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="opacity-60">
            <Logo width={120} />
          </div>
          <div className="text-xs uppercase tracking-widest text-stone-600">
            © {new Date().getFullYear()} void anchae. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
