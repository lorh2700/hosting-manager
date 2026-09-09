'use client';

import { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import styles from './StayHero.module.css';

export function ScrollUnfoldHero() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: sceneRef, offset: ['start start', 'end start'] });
  const photoY = useTransform(scrollYProgress, [0, 1], ['0%', '10%']);

  return (
    <section className={styles.hero} aria-labelledby="stay-hero-title">
      <div className={styles.scene} ref={sceneRef}>
        <motion.div className={styles.photoFrame} style={{ y: reducedMotion ? 0 : photoY }}>
          <Image src="/images/unwa/main.webp" alt="열린 나무 창호 사이로 빛이 드는 운와당의 한옥 실내" fill priority sizes="100vw" quality={85} className={styles.photo} />
        </motion.div>
        <div className={styles.shade} aria-hidden="true" />
        <div className={styles.content}>
          <p className={styles.eyebrow}><span aria-hidden="true" /> BUKCHON, SEOUL · HANOK STAY</p>
          <h1 id="stay-hero-title" className={styles.title}>북촌의 골목 끝,<br /><span>나만의 머무름.</span></h1>
          <p className={styles.description}>오래된 집의 온기와 오늘의 편안함.<br />잠시 일상을 비우고, 당신의 시간으로 채우세요.</p>
          <div className={styles.actions}>
            <Link href="#spaces" className={styles.primary}>공간 둘러보기 <ArrowDown size={17} aria-hidden="true" /></Link>
            <Link href="/brand" className={styles.secondary}>안채의 이야기 <ArrowUpRight size={17} aria-hidden="true" /></Link>
          </div>
        </div>
        <Link href="/book/unwadang" className={styles.caption} aria-label="사진 속 운와당의 공간과 예약 정보 보기">
          <span className={styles.captionIndex}>01 / OUR SPACES</span>
          <span className={styles.captionName}>운와당 <span>雲窩堂</span><ArrowUpRight size={19} aria-hidden="true" /></span>
          <span className={styles.captionDetail}>구름이 머무는 마당</span>
        </Link>
        <span className={styles.vertical} aria-hidden="true">A QUIET PLACE OF YOUR OWN</span>
      </div>
      <div className={styles.note}>
        <p>도시의 한가운데서 만나는 <span>고요한 한옥의 하루.</span></p>
        <Link href="#spaces">머물고 싶은 공간을 찾아보세요 <ArrowUpRight size={16} aria-hidden="true" /></Link>
      </div>
    </section>
  );
}
