'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, MotionValue } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';

const menuItems = [
  { title: 'SPACES', desc: '우리의 공간들', img: '/images/unwa/main.webp', link: '#spaces' },
  { title: 'ABOUT', desc: '우리의 철학', img: '/images/main_yard.webp', link: '#about' },
  { title: 'JOURNAL', desc: '이야기', img: '/images/hwayeon/hwayeon_after.webp', link: '#journal' },
  { title: 'CONTACT', desc: '문의하기', img: '/images/anon/main.webp', link: '#contact' },
];

function MenuCard({ item, index, scrollYProgress }: { item: any, index: number, scrollYProgress: MotionValue<number> }) {
  const start = 0.08 + (index * 0.10);
  const end = start + 0.30;

  const y = useTransform(scrollYProgress, [start, end], ["120vh", "0vh"]);
  const rotate = useTransform(scrollYProgress, [start, end], [20, (index - 1.5) * 8]);
  const x = useTransform(scrollYProgress, [start, end], ["0vw", `${(index - 1.5) * 22}vw`]);
  const scale = useTransform(scrollYProgress, [start, end], [0.8, 1]);

  return (
    <motion.div
      style={{ y, rotate, x, scale }}
      className="absolute w-[240px] md:w-[280px] lg:w-[320px] h-[360px] md:h-[420px] lg:h-[480px] bg-stone-900 border border-stone-800 rounded-2xl overflow-hidden shadow-2xl origin-bottom pointer-events-auto"
    >
      <Link href={item.link} className="block w-full h-full group">
        <Image
          src={item.img}
          alt={item.title}
          fill
          sizes="(min-width: 1024px) 320px, (min-width: 768px) 280px, 240px"
          className="object-cover opacity-60 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700"
        />
        <div className="absolute inset-0 p-8 flex flex-col justify-end bg-gradient-to-t from-stone-950/90 via-stone-950/40 to-transparent">
          <h3 className="text-2xl font-light tracking-widest mb-2">{item.title}</h3>
          <p className="text-stone-300 text-sm font-light">{item.desc}</p>
        </div>
      </Link>
    </motion.div>
  );
}

export function ScrollUnfoldHero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

  const textOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0]);
  const textY = useTransform(scrollYProgress, [0, 0.15], [0, -100]);
  const textScale = useTransform(scrollYProgress, [0, 0.15], [1, 0.9]);

  return (
    <div ref={containerRef} data-scroll-hero className="relative h-[250vh] bg-[#0C0A09] w-full">
      <div className="sticky top-0 h-screen w-full overflow-hidden flex flex-col items-center justify-center">

        {/* Hero Text */}
        <motion.div
          style={{ opacity: textOpacity, y: textY, scale: textScale }}
          className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10 pointer-events-none"
        >
          <h1 className="text-5xl md:text-7xl lg:text-[90px] font-light tracking-tight leading-[1.1] mb-8">
            당신만의 특별한<br />머무름
          </h1>
          <p className="text-stone-200 text-sm md:text-base font-light tracking-wide max-w-2xl leading-relaxed mb-12">
            북촌의 디자인 한옥 스테이.<br className="hidden md:block" />
            정성스럽게 가꾼 공간에서, 시간이 머무는 머무름을 경험해 보세요.
          </p>
          <div className="flex flex-col items-center gap-4">
            <div className="w-[1px] h-12 bg-gradient-to-b from-stone-400 to-transparent"></div>
            <div className="text-xs uppercase tracking-[0.3em] text-stone-400">
              Scroll to explore
            </div>
          </div>
        </motion.div>

        {/* Unfolding Cards */}
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none mt-20">
          {menuItems.map((item, i) => (
            <MenuCard key={item.title} item={item} index={i} scrollYProgress={scrollYProgress} />
          ))}
        </div>
      </div>
    </div>
  );
}
