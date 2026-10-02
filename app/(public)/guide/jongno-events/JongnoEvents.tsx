'use client';

/* eslint-disable @next/next/no-img-element -- Editorial images use administrator-provided hosts; direct loading avoids an unrestricted optimizer allowlist. Previews have fixed sizes and load lazily. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowUpRight, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock, MapPin, Ticket, X } from 'lucide-react';
import { NavigationLink } from '@/components/NavigationFeedback';
import { usePublicLanguage } from '@/components/PublicLanguage';
import { JONGNO_AREA_LABELS, JONGNO_CATEGORY_LABELS, jongnoDateLabel, jongnoEventFee, jongnoEventTitle, jongnoVerifiedDate, readJongnoEvents,
  jongnoRangeDays as rangeDays, jongnoMonthDays as monthDays, moveJongnoMonth as moveMonth, type JongnoEventsResponse } from '@/lib/jongno-events-view';
import { eventHasOccurrenceInRange, eventOccursOn, isJongnoDate, jongnoToday, type JongnoEventDTO } from '@/lib/jongno-events';
import styles from './JongnoEvents.module.css';

type Range = { from: string; to: string };
function inRange(date: string, range: Range | null) { return !!range && date >= range.from && date <= range.to; }

function EventCard({ event, language, highlight }: { event: JongnoEventDTO; language: 'ko' | 'en'; highlight: boolean }) {
  const en = language === 'en', title = jongnoEventTitle(event, language);
  const [expanded, setExpanded] = useState(highlight);
  const [photo, setPhoto] = useState<number | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const galleryOpen = photo !== null;
  useEffect(() => {
    const node = dialog.current;
    if (!galleryOpen || !node) return;
    const active = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    node.showModal(); document.body.style.overflow = 'hidden';
    return () => { node.close(); document.body.style.overflow = previousOverflow; if (active?.isConnected) active.focus(); };
  }, [galleryOpen]);
  const cover = event.images[0];
  const selectedPhoto = photo !== null ? event.images[photo] : null;
  const checkedDate = jongnoVerifiedDate(event.verifiedAt);
  const links = [
    { href: event.officialUrl, label: en ? 'Official information' : '공식 안내' },
    { href: event.bookingUrl, label: en ? 'Booking & sessions' : '예약·회차 확인' },
    { href: event.mapUrl, label: en ? 'Open map' : '지도 보기' },
  ].filter(link => link.href);
  const description = en ? event.descriptionEn || event.descriptionKo : event.descriptionKo || event.descriptionEn;
  const closedDays = event.excludedWeekdays.map(day => (en ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['일', '월', '화', '수', '목', '금', '토'])[day]);
  return <article id={`event-${event.id}`} className={`${styles.card} ${highlight ? styles.highlightCard : ''}`}>
    <div className={styles.cardSummary}>
      {cover && !coverFailed ? <img src={cover.url} alt={cover.alt || title} loading="lazy" decoding="async" width="240" height="180" onError={() => setCoverFailed(true)} className={styles.cover} /> : <div className={styles.noCover} aria-hidden="true"><CalendarDays size={26} strokeWidth={1.2} /></div>}
      <div className={styles.cardText}>
        <div className={styles.badges}><span>{JONGNO_CATEGORY_LABELS[event.category][language]}</span><span>{JONGNO_AREA_LABELS[event.area][language]}</span>{event.feeType === 'free' && <span>{en ? 'Free' : '무료'}</span>}</div>
        <h3>{title}</h3>
        {en && !event.titleEn && <p className={styles.small}>{en ? 'Official title shown in Korean' : ''}</p>}
        <p className={styles.meta}><CalendarDays size={15} aria-hidden="true" /><span>{jongnoDateLabel(event.startDate, language, { year: 'numeric', month: 'short', day: 'numeric' })} – {jongnoDateLabel(event.endDate, language)}</span></p>
        <p className={styles.meta}><MapPin size={15} aria-hidden="true" /><span>{event.venue || JONGNO_AREA_LABELS[event.area][language]}</span></p>
        <p className={styles.meta}><Clock size={15} aria-hidden="true" /><span>{event.timeText || (en ? 'Session times: check official information' : '회차·시간은 공식 안내에서 확인')}</span></p>
        <p className={styles.fee}><Ticket size={15} aria-hidden="true" /><span>{jongnoEventFee(event, language)}{event.bookingRequired ? ` · ${en ? 'Booking required' : '사전 예약 필요'}` : ''}</span></p>
      </div>
    </div>
    <details className={styles.detail} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>{en ? 'Details & photos' : '자세한 안내·사진'}<ChevronDown size={16} aria-hidden="true" /></summary>
      {expanded && <div className={styles.detailBody}>
        {description && <p className={styles.description}>{description}</p>}
        {en && !event.descriptionEn && description && <p className={styles.small}>The organizer’s description is available in Korean.</p>}
        <dl className={styles.facts}>
          {event.address && <><dt>{en ? 'Address' : '주소'}</dt><dd>{event.address}</dd></>}
          <dt>{en ? 'Fee' : '이용 요금'}</dt><dd>{jongnoEventFee(event, language)}</dd>
          {event.languageText && <><dt>{en ? 'Language' : '진행 언어'}</dt><dd>{event.languageText}</dd></>}
          {!!closedDays.length && <><dt>{en ? 'Closed weekdays' : '정기 휴관일'}</dt><dd>{closedDays.join(' · ')}{en ? '' : '요일'}</dd></>}
          {!!event.excludedDates.length && <><dt>{en ? 'Other closures' : '별도 휴관일'}</dt><dd>{event.excludedDates.map(date => jongnoDateLabel(date, language)).join(' · ')}</dd></>}
        </dl>
        {!!event.images.length && <div className={styles.photoGallery} aria-label={en ? `${title} photos` : `${title} 사진`}>{event.images.map((image, index) => <div key={`${image.url}-${index}`}>
          <button type="button" onClick={() => setPhoto(index)} aria-label={en ? `Enlarge photo ${index + 1}: ${image.alt || title}` : `${index + 1}번째 사진 크게 보기: ${image.alt || title}`}><img src={image.url} alt={image.alt || title} width="320" height="220" loading="lazy" decoding="async" /></button>
          {(image.credit || image.sourceUrl) && <p className={styles.photoCredit}>{image.credit}{image.sourceUrl && <>{image.credit ? ' · ' : ''}<a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">{en ? 'Source' : '출처'}</a></>}</p>}
        </div>)}</div>}
        <div className={styles.externalLinks}>{links.map(link => <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<ArrowUpRight size={15} aria-hidden="true" /><span className="sr-only">{en ? ' (new tab)' : ' (새 창)'}</span></a>)}</div>
        <p className={styles.small}>{en ? 'A calendar date shows the published event period, not a guaranteed session or available ticket. Please confirm hours and bookings with the organizer.' : '달력에는 공개된 행사 기간을 표시합니다. 해당 날짜의 회차 진행이나 남은 예약을 보장하지 않으므로 방문 전 주최 측 안내를 확인해 주세요.'}</p>
        {checkedDate && <p className={styles.small}>{en ? 'Information checked (Seoul): ' : '정보 확인일 (서울): '}{jongnoDateLabel(checkedDate, language, { year: 'numeric', month: 'short', day: 'numeric' })}</p>}
      </div>}
    </details>
    <dialog ref={dialog} className={styles.galleryDialog} aria-label={en ? `${title} photo gallery` : `${title} 사진 갤러리`} onCancel={event => { event.preventDefault(); setPhoto(null); }} onClick={event => { if (event.target === event.currentTarget) setPhoto(null); }}>
      {selectedPhoto && <div className={styles.galleryContent}>
        <div className={styles.galleryHeader}><p>{title}<span>{photo! + 1} / {event.images.length}</span></p><button type="button" onClick={() => setPhoto(null)} aria-label={en ? 'Close photos' : '사진 닫기'}><X size={22} /></button></div>
        <img src={selectedPhoto.url} alt={selectedPhoto.alt || title} className={styles.largePhoto} decoding="async" />
        <div className={styles.galleryFooter}><button type="button" disabled={photo === 0} onClick={() => setPhoto(value => Math.max(0, value! - 1))} aria-label={en ? 'Previous photo' : '이전 사진'}><ChevronLeft size={20} /></button><p>{selectedPhoto.alt}<span>{selectedPhoto.credit}{selectedPhoto.sourceUrl && <>{selectedPhoto.credit ? ' · ' : ''}<a href={selectedPhoto.sourceUrl} target="_blank" rel="noopener noreferrer">{en ? 'Source' : '출처'}</a></>}</span></p><button type="button" disabled={photo === event.images.length - 1} onClick={() => setPhoto(value => Math.min(event.images.length - 1, value! + 1))} aria-label={en ? 'Next photo' : '다음 사진'}><ChevronRight size={20} /></button></div>
      </div>}
    </dialog>
  </article>;
}

export default function JongnoEvents() {
  const search = useSearchParams();
  const { language, setLanguage } = usePublicLanguage();
  const en = language === 'en', today = jongnoToday();
  const from = search.get('from'), to = search.get('to');
  const validStay = isJongnoDate(from) && isJongnoDate(to) && from! <= to!;
  const stayRange = validStay ? { from: from!, to: to! } : null;
  const initialRange = stayRange && rangeDays(stayRange.from, stayRange.to) <= 93 ? stayRange : null;
  const [month, setMonth] = useState((stayRange?.from || today).slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(stayRange?.from || today);
  const [view, setView] = useState<'dates' | 'month'>('dates');
  const [allDates, setAllDates] = useState(false);
  const [focusEvent, setFocusEvent] = useState('');
  const [range, setRange] = useState<Range | null>(initialRange);
  const [fromInput, setFromInput] = useState(stayRange?.from || '');
  const [toInput, setToInput] = useState(stayRange?.to || '');
  const [rangeError, setRangeError] = useState(false);
  const [category, setCategory] = useState<keyof typeof JONGNO_CATEGORY_LABELS | ''>('');
  const [area, setArea] = useState<keyof typeof JONGNO_AREA_LABELS | ''>('');
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<(JongnoEventsResponse & { key: string }) | null>(null);
  const [errorKey, setErrorKey] = useState('');
  const [loadingMoreKey, setLoadingMoreKey] = useState('');
  const [moreErrorKey, setMoreErrorKey] = useState('');
  const sequence = useRef(0);
  const pagination = useRef<AbortController | null>(null);
  const dateStrip = useRef<HTMLDivElement>(null);
  const handedLanguage = useRef(false);
  const suppliedDates = useRef(`${from || ''}|${to || ''}`);
  const scrolledEvent = useRef('');
  const invalidateRequest = useCallback((request: number) => {
    if (sequence.current !== request) return;
    ++sequence.current;
    pagination.current?.abort();
  }, []);
  const suppliedQuery = search.toString();
  const query = new URLSearchParams({ ...(range ? { from: range.from, to: range.to } : { month }),
    ...(category ? { category } : {}), ...(area ? { area } : {}), limit: '100' }).toString();
  const current = data?.key === query ? data : null;
  const loading = !current && errorKey !== query;
  const events = current?.events.filter(event => event.status === 'published' && eventHasOccurrenceInRange(event, current.range.from, current.range.to)) ?? [];
  const days = monthDays(month), firstWeekday = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const visibleEvents = allDates ? events : events.filter(event => eventOccursOn(event, selectedDate));
  const weekdayLabels = en ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['일', '월', '화', '수', '목', '금', '토'];
  useEffect(() => {
    if (!handedLanguage.current) { const supplied = search.get('lang'); if (supplied === 'en' || supplied === 'ko') setLanguage(supplied); handedLanguage.current = true; }
    const dateKey = `${from || ''}|${to || ''}`;
    if (suppliedDates.current !== dateKey) {
      suppliedDates.current = dateKey;
      const suppliedRange = isJongnoDate(from) && isJongnoDate(to) && from <= to ? { from, to } : null;
      setRange(suppliedRange && rangeDays(suppliedRange.from, suppliedRange.to) <= 93 ? suppliedRange : null);
      setMonth((suppliedRange?.from || today).slice(0, 7)); setSelectedDate(suppliedRange?.from || today);
      setFromInput(suppliedRange?.from || ''); setToInput(suppliedRange?.to || ''); setRangeError(false); setAllDates(false);
      scrolledEvent.current = '';
    }
    // IDs are UUIDs; reading an arbitrary encoded hash must not throw during hydration.
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('event-')) { setFocusEvent(hash.slice(6)); setAllDates(true); }
    else setFocusEvent('');
  }, [suppliedQuery, from, to, today, search, setLanguage]);
  useEffect(() => {
    const request = ++sequence.current, controller = new AbortController();
    pagination.current?.abort(); setLoadingMoreKey(''); setMoreErrorKey(''); setData(null);
    const timer = setTimeout(() => controller.abort(), 12000);
    readJongnoEvents(query, controller.signal).then(result => {
      if (sequence.current === request) { setData({ ...result, key: query }); setErrorKey(''); }
    }).catch(() => { if (sequence.current === request) setErrorKey(query); }).finally(() => clearTimeout(timer));
    return () => { invalidateRequest(request); clearTimeout(timer); controller.abort(); };
  }, [query, retry, invalidateRequest]);
  useEffect(() => {
    const strip = dateStrip.current;
    const selected = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (strip && selected) strip.scrollTo({ left: selected.offsetLeft - strip.offsetLeft - strip.clientWidth / 2 + selected.clientWidth / 2, behavior: 'auto' });
  }, [month, selectedDate, view]);
  useEffect(() => {
    if (!focusEvent || loading || scrolledEvent.current === focusEvent) return;
    const card = document.getElementById(`event-${focusEvent}`);
    if (card) { card.scrollIntoView({ block: 'start', behavior: 'auto' }); scrolledEvent.current = focusEvent; }
  }, [focusEvent, loading, visibleEvents.length]);
  function chooseMonth(amount: number) {
    const next = moveMonth(month, amount); setMonth(next); setRange(null); setSelectedDate(`${next}-01`); setAllDates(false); setFocusEvent('');
  }
  function chooseDate(date: string) { setSelectedDate(date); setAllDates(false); setFocusEvent(''); }
  async function loadMore() {
    if (!current?.nextCursor || loadingMoreKey === query) return;
    const request = sequence.current, controller = new AbortController(); pagination.current?.abort(); pagination.current = controller;
    const timer = setTimeout(() => controller.abort(), 12000);
    setLoadingMoreKey(query); setMoreErrorKey('');
    try {
      const nextQuery = new URLSearchParams(query); nextQuery.set('cursor', current.nextCursor);
      const result = await readJongnoEvents(nextQuery.toString(), controller.signal);
      if (request === sequence.current) setData(previous => {
        if (!previous || previous.key !== query) return previous;
        const byId = new Map(previous.events.map(event => [event.id, event])); result.events.forEach(event => byId.set(event.id, event));
        return { ...result, key: query, events: [...byId.values()] };
      });
    } catch { if (request === sequence.current) setMoreErrorKey(query); }
    finally { clearTimeout(timer); if (request === sequence.current) setLoadingMoreKey(''); }
  }
  function applyRange() {
    if (!isJongnoDate(fromInput) || !isJongnoDate(toInput) || fromInput > toInput || rangeDays(fromInput, toInput) > 93) { setRangeError(true); return; }
    setRangeError(false); setRange({ from: fromInput, to: toInput }); setMonth(fromInput.slice(0, 7)); setSelectedDate(fromInput); setAllDates(true); setFocusEvent('');
  }
  function retryRead() { setErrorKey(''); setRetry(value => value + 1); }
  return <main className={styles.page}>
    <header className={styles.hero}><div className={styles.container}>
      <p className={styles.eyebrow}>SEOUL / JONGNO CULTURAL CALENDAR</p>
      <h1 className="brand-serif">{en ? <>A date with<br />Jongno.</> : <>머무는 날,<br />종로를 만나다.</>}</h1>
      <p className={styles.intro}>{en ? 'Exhibitions, performances and small discoveries around Bukchon. Find a cultural stop for your stay.' : '북촌과 인사동, 서촌과 대학로의 전시·공연·축제. 머무는 날에 어울리는 문화 일정을 찾아보세요.'}</p>
    </div></header>
    <section className={`${styles.container} ${styles.content}`} aria-label={en ? 'Browse cultural events' : '문화 일정 둘러보기'}>
      <nav className={styles.guideNav} aria-label={en ? 'Local guides' : '지역 가이드'}><NavigationLink href="/guide">{en ? 'Bukchon guide' : '북촌 가이드'}</NavigationLink><NavigationLink href="/guide/jongno-events" aria-current="page">{en ? 'Jongno calendar' : '종로 문화 일정'}</NavigationLink><NavigationLink href="/guide/yeongju">{en ? 'Yeongju guide' : '영주 가이드'}</NavigationLink></nav>
      {stayRange && <p className={styles.stayNotice}><CalendarDays size={17} aria-hidden="true" /><span>{en ? 'Your stay: ' : '머무는 기간: '}{jongnoDateLabel(stayRange.from, language)} – {jongnoDateLabel(stayRange.to, language)} <small>{en ? 'Includes check-out day · shaded on the calendar' : '체크아웃 당일 포함 · 달력 배경으로 표시'}</small>{!initialRange && <small>{en ? 'Browse a long stay month by month.' : '긴 일정은 월별로 둘러보세요.'}</small>}</span></p>}
      <div className={styles.toolbar}>
        <div className={styles.monthControl}><button type="button" disabled={month === '1900-01'} onClick={() => chooseMonth(-1)} aria-label={en ? 'Previous month' : '이전 달'}><ChevronLeft size={20} /></button><h2>{jongnoDateLabel(`${month}-01`, language, { year: 'numeric', month: 'long' })}</h2><button type="button" disabled={month === '2199-12'} onClick={() => chooseMonth(1)} aria-label={en ? 'Next month' : '다음 달'}><ChevronRight size={20} /></button></div>
        <div className={styles.viewControls}><button type="button" onClick={() => { setMonth(today.slice(0, 7)); setSelectedDate(today); setRange(null); setAllDates(false); setFocusEvent(''); }}>{en ? 'Today' : '오늘'}</button><div role="group" aria-label={en ? 'Calendar view' : '달력 보기 방식'}><button type="button" aria-pressed={view === 'dates'} onClick={() => setView('dates')}>{en ? 'By date' : '날짜별'}</button><button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>{en ? 'Month' : '월 달력'}</button></div></div>
      </div>
      <div className={styles.filters}><label>{en ? 'Category' : '분류'}<select value={category} onChange={event => { setCategory(event.target.value as typeof category); setFocusEvent(''); }}><option value="">{en ? 'All categories' : '전체 분류'}</option>{Object.entries(JONGNO_CATEGORY_LABELS).map(([key, labels]) => <option key={key} value={key}>{labels[language]}</option>)}</select></label><label>{en ? 'Area' : '지역'}<select value={area} onChange={event => { setArea(event.target.value as typeof area); setFocusEvent(''); }}><option value="">{en ? 'All areas' : '전체 지역'}</option>{Object.entries(JONGNO_AREA_LABELS).map(([key, labels]) => <option key={key} value={key}>{labels[language]}</option>)}</select></label>
        <details className={styles.periodFilter}><summary>{en ? 'Choose dates' : '기간 선택'}</summary><div><label>{en ? 'From' : '시작일'}<input type="date" value={fromInput} onChange={event => setFromInput(event.target.value)} /></label><label>{en ? 'To' : '종료일'}<input type="date" value={toInput} onChange={event => setToInput(event.target.value)} /></label><button type="button" onClick={applyRange}>{en ? 'Apply' : '적용'}</button>{range && <button type="button" onClick={() => { setRange(null); setAllDates(false); setRangeError(false); }}>{en ? 'Clear dates' : '기간 해제'}</button>}{rangeError && <p role="alert">{en ? 'Choose an ordered date range of up to 93 days.' : '시작일과 종료일을 확인해 주세요. 한 번에 최대 93일까지 조회할 수 있습니다.'}</p>}</div></details>
      </div>
      {range && <p className={styles.rangeLabel}>{en ? 'Showing: ' : '조회 기간: '}{jongnoDateLabel(range.from, language)} – {jongnoDateLabel(range.to, language)}{stayRange && range.from === stayRange.from && range.to === stayRange.to ? (en ? ' · Includes check-out day' : ' · 체크아웃 당일 포함') : ''}</p>}
      {view === 'dates' ? <div ref={dateStrip} className={styles.dateStrip} role="group" aria-label={en ? 'Choose a date' : '날짜 선택'}>{days.map(date => {
        const count = events.filter(event => eventOccursOn(event, date)).length;
        return <button key={date} type="button" onClick={() => chooseDate(date)} aria-pressed={!allDates && selectedDate === date} aria-label={`${jongnoDateLabel(date, language, { month: 'long', day: 'numeric', weekday: 'long' })} · ${count} ${en ? 'listed events' : '개 문화 일정'}${inRange(date, stayRange) ? (en ? ' · your stay' : ' · 투숙 기간') : ''}`} className={`${inRange(date, stayRange) ? styles.stayDay : ''} ${date === today ? styles.todayDay : ''}`}><span>{weekdayLabels[new Date(`${date}T00:00:00Z`).getUTCDay()]}</span><strong>{Number(date.slice(8))}</strong><i aria-hidden="true" className={count ? styles.eventDot : styles.emptyDot} /></button>;
      })}</div> : <div className={styles.monthCalendar}><table><caption className="sr-only">{jongnoDateLabel(`${month}-01`, language, { year: 'numeric', month: 'long' })}</caption><thead><tr>{weekdayLabels.map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{Array.from({ length: Math.ceil((firstWeekday + days.length) / 7) }, (_, week) => <tr key={week}>{Array.from({ length: 7 }, (_, weekday) => {
        const date = days[week * 7 + weekday - firstWeekday];
        if (!date) return <td key={weekday} />;
        const count = events.filter(event => eventOccursOn(event, date)).length;
        return <td key={weekday}><button type="button" aria-pressed={!allDates && date === selectedDate} onClick={() => chooseDate(date)} aria-label={`${jongnoDateLabel(date, language, { month: 'long', day: 'numeric', weekday: 'long' })} · ${count} ${en ? 'listed events' : '개 문화 일정'}${inRange(date, stayRange) ? (en ? ' · your stay' : ' · 투숙 기간') : ''}`} className={`${inRange(date, stayRange) ? styles.stayDay : ''} ${date === today ? styles.todayDay : ''}`}><span>{Number(date.slice(8))}</span><i aria-hidden="true" className={count ? styles.eventDot : styles.emptyDot} />{count > 0 && <small>{count}</small>}</button></td>;
      })}</tr>)}</tbody></table></div>}
      <div className={styles.legend}><span><i className={styles.eventDot} />{en ? 'Listed cultural event' : '등록된 문화 일정'}</span>{stayRange && <span><i className={styles.staySquare} />{en ? 'Your stay' : '투숙 기간'}</span>}<p>{en ? 'Closed weekdays and published closure dates are excluded. Check session availability on the official page.' : '정기 휴관일과 등록된 별도 휴관일은 제외합니다. 회차·예약 가능 여부는 공식 안내에서 확인해 주세요.'}</p></div>
      <div className={styles.listHeading}><h2 className="brand-serif">{allDates ? (en ? 'Events in this period' : '기간 내 문화 일정') : jongnoDateLabel(selectedDate, language, { month: 'long', day: 'numeric', weekday: 'long' })}</h2><button type="button" aria-pressed={allDates} onClick={() => { setAllDates(value => !value); setFocusEvent(''); }}>{allDates ? (en ? 'Selected day' : '선택한 날짜만') : (en ? 'Whole period' : '기간 전체 보기')}</button></div>
      {loading && <div className={styles.loading} role="status"><CalendarDays className={styles.loadingIcon} size={30} strokeWidth={1.2} aria-hidden="true" /><p>{en ? 'Looking up cultural events…' : '문화 일정을 확인하고 있어요…'}</p></div>}
      {errorKey === query && <div className={styles.empty} role="status"><h3>{en ? 'The calendar is temporarily unavailable.' : '문화 일정을 불러오지 못했습니다.'}</h3><p>{en ? 'Please try again in a moment. You can still explore the Bukchon guide.' : '잠시 후 다시 확인해 주세요. 북촌 가이드는 계속 둘러보실 수 있습니다.'}</p><button type="button" onClick={retryRead}>{en ? 'Try again' : '다시 불러오기'}</button><NavigationLink href="/guide">{en ? 'Explore Bukchon' : '북촌 가이드 보기'}</NavigationLink></div>}
      {!loading && current && !visibleEvents.length && <div className={styles.empty}><CalendarDays size={28} strokeWidth={1.2} aria-hidden="true" /><h3>{en ? 'No verified events listed for these dates yet.' : '이 날짜에 등록된 확인된 문화 일정이 아직 없습니다.'}</h3><p>{en ? 'Try another date or browse the whole period. Filtered results do not include every event in the neighborhood.' : '다른 날짜나 기간 전체를 살펴보세요. 이 목록은 주변의 모든 행사를 포함하지 않습니다.'}</p>{!allDates && <button type="button" onClick={() => setAllDates(true)}>{en ? 'Show whole period' : '기간 전체 보기'}</button>}{(category || area) && <button type="button" onClick={() => { setCategory(''); setArea(''); }}>{en ? 'Clear filters' : '분류·지역 전체 보기'}</button>}<NavigationLink href="/guide">{en ? 'Explore Bukchon' : '북촌 가이드 보기'}</NavigationLink></div>}
      {!loading && current && <div className={styles.eventList}>{visibleEvents.map(event => <EventCard key={`${event.id}:${event.id === focusEvent ? 'highlight' : 'normal'}`} event={event} language={language} highlight={event.id === focusEvent} />)}</div>}
      {current?.hasMore && current.nextCursor && <div className={styles.pagination}>{moreErrorKey === query && <p role="status">{en ? 'More events could not be loaded. Please retry.' : '추가 일정을 불러오지 못했습니다. 다시 확인해 주세요.'}</p>}<button type="button" disabled={loadingMoreKey === query} onClick={loadMore}>{loadingMoreKey === query ? (en ? 'Loading…' : '불러오는 중…') : (en ? 'Load more events' : '문화 일정 더 보기')}</button><p>{en ? 'The calendar currently shows loaded events only.' : '달력의 점은 현재 불러온 일정을 기준으로 표시합니다.'}</p></div>}
      <aside className={styles.beforeVisit}><h2>{en ? 'Before you go' : '방문 전 확인해 주세요'}</h2><p>{en ? 'Event periods, fees and bookings can change. We list checked information and link to the organizer for the latest details. A listed date does not guarantee a running session or an available ticket.' : '행사 일정·요금·예약 방식은 바뀔 수 있습니다. 확인한 정보를 모아 안내하며 최신 내용은 주최 측 공식 페이지에서 확인해 주세요. 달력에 날짜가 표시되어도 회차 진행이나 남은 예약을 보장하지 않습니다.'}</p></aside>
    </section>
  </main>;
}
