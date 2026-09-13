'use client';
import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { usePublicLanguage } from '@/components/PublicLanguage';
import { todayKst } from '@/lib/dates';
import { parseStaySearch, type StaySearch } from '@/lib/stay-search';
import styles from './StayBookingSearch.module.css';
export function StayBookingSearch({ onSearch, loading }: { onSearch: (search: StaySearch) => void; loading: boolean }) {
  const { language } = usePublicLanguage();
  const en = language === 'en';
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guests, setGuests] = useState(2);
  const [invalid, setInvalid] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = parseStaySearch({ checkIn, checkOut, guests, pets: 0 });
    setInvalid(!search);
    if (search) onSearch(search);
  }
  const tomorrow = checkIn ? new Date(Date.parse(checkIn) + 86400000).toISOString().slice(0, 10) : todayKst();
  return <section id="find-stay" aria-label={en ? 'Search availability' : '예약 가능한 숙소 검색'} className={styles.section}>
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}><label htmlFor="search-arrival">{en ? 'Check-in' : '체크인'}</label>
        <input id="search-arrival" type="date" required min={todayKst()} value={checkIn} onChange={e => { setCheckIn(e.target.value); if (e.target.value >= checkOut) setCheckOut(''); }} /></div>
      <div className={styles.field}><label htmlFor="search-departure">{en ? 'Check-out' : '체크아웃'}</label>
        <input id="search-departure" type="date" required min={tomorrow} value={checkOut} onChange={e => setCheckOut(e.target.value)} /></div>
      <div className={styles.field}><label htmlFor="search-guests">{en ? 'Guests' : '인원'}</label>
        <select id="search-guests" value={guests} onChange={e => setGuests(Number(e.target.value))}>{Array.from({ length: 20 }, (_, i) => <option key={i} value={i + 1}>{i + 1}{en ? ' guests' : '명'}</option>)}</select></div>
      <button type="submit" disabled={loading}><Search size={18} aria-hidden="true" />{loading ? (en ? 'Searching…' : '검색 중…') : (en ? 'Find a stay' : '숙소 검색')}</button>
    </form>
    {invalid && <p role="alert" className={styles.notice}>{en ? 'Select a future stay of 1–30 nights.' : '오늘 이후의 날짜로 1~30박 일정을 선택해주세요.'}</p>}
  </section>;
}
