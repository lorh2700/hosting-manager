'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { PROPERTY_DISPLAY, PROPERTY_DISPLAY_ORDER } from '@/lib/property-display';
import styles from './StayBookingSearch.module.css';

export function StayBookingSearch() {
  const router = useRouter();
  const [slug, setSlug] = useState('');
  const stays = PROPERTY_DISPLAY_ORDER.map(key => PROPERTY_DISPLAY[key]).filter(p => p?.status === 'active');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stays.some(stay => stay.slug === slug)) router.push(`/book/${slug}`);
  }
  return (
    <section id="find-stay" aria-labelledby="find-stay-title" className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>FIND YOUR STAY</p>
          <h2 id="find-stay-title">어느 한옥에서 쉬어갈까요?</h2>
          <p>공간을 고르고, 가능한 날짜와 요금을 확인하세요.</p>
        </div>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.field}>
            <label htmlFor="stay-selection">머물고 싶은 한옥</label>
            <select id="stay-selection" value={slug} onChange={e => setSlug(e.target.value)} required>
              <option value="" disabled>숙소를 선택해주세요</option>
              {stays.map(stay => <option key={stay.slug} value={stay.slug}>{stay.name} · {stay.region}</option>)}
            </select>
          </div>
          <button type="submit">날짜 · 요금 확인 <ArrowUpRight size={18} aria-hidden="true" /></button>
        </form>
      </div>
    </section>
  );
}
