'use client';

import { usePublicLanguage } from '@/components/PublicLanguage';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { PROPERTY_DISPLAY, PROPERTY_DISPLAY_ORDER } from '@/lib/property-display';
import styles from './StayBookingSearch.module.css';

export function StayBookingSearch() {
  const { t } = usePublicLanguage();
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
          <h2 id="find-stay-title">{t("머무를 한옥")}</h2>
        </div>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.field}>
            <label htmlFor="stay-selection">{t("머물고 싶은 한옥")}</label>
            <select id="stay-selection" value={slug} onChange={e => setSlug(e.target.value)} required>
              <option value="" disabled>{t("숙소를 선택해주세요")}</option>
              {stays.map(stay => <option key={stay.slug} value={stay.slug}>{t(stay.name)} · {t(stay.region)}</option>)}
            </select>
          </div>
          <button type="submit">{t("날짜 · 요금 확인")}<ArrowUpRight size={18} aria-hidden="true" /></button>
        </form>
      </div>
    </section>
  );
}
