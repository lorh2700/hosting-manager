'use client';

import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, CalendarDays, CarFront, Check, ChevronRight, CircleHelp, ClipboardList, Copy, Home, Leaf, LoaderCircle, LogOut, MapPin, Minus, Plus, RefreshCw, ShieldCheck, Sparkles, Wifi } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { guestLanguageNames, guestLanguages, type GuestLanguage } from '@/lib/guest-languages';
import { guestTourCopy } from '@/lib/guest-tour-copy';
import { addDaysToDateStr, todayKst } from '@/lib/dates';
import { getPropertyDisplay } from '@/lib/property-display';
import { guestGuide } from '@/lib/guest-guide';
import type { GuestStayDTO, GuestStayPropertyDTO, GuestStayRequestDTO, GuestStayRequestInput } from '@/lib/guest-stay';
import { guestStayTranslation } from './GuestStayCopy';
import styles from './GuestStay.module.css';

type Tab = 'home' | 'guide' | 'services' | 'requests';
type Service = 'tour' | 'taxi' | 'help';
type SessionResponse = { stay: GuestStayDTO; csrfToken: string };
type GuideSection = { id: string; title: string; paragraphs: string[]; images?: { url: string; alt: string }[] };
type Tour = { id: string; title: string; slug: string; description: string | null; images: string[]; basePrice: number | null; durationMin: number | null; maxGroupSize: number | null };
type TourDetail = Tour & { durationOptions: { id: string; label: string | null; durationMin: number; price: number }[]; ticketTiers: { id: string; label: string; price: number; notes: string | null }[] };
type Credentials = { invitation?: string; accessToken?: string };
class ApiError extends Error {
  constructor(public status: number, public code?: string) { super('Guest service request failed'); }
}
async function api<T>(url: string, options?: RequestInit, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(15000);
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.code);
  return data as T;
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const money = (price: number, lang: GuestLanguage) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(price);
const calendarDate = (value: string, lang: GuestLanguage) => new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date(value + 'T12:00:00+09:00'));
function fallbackProperty(slug: string): GuestStayPropertyDTO {
  const display = getPropertyDisplay(slug)!;
  const publicGuide = guestGuide(slug);
  return { id: '', slug: display.slug, name: display.name, nameEn: publicGuide?.nameEn || 'Dowonjae', image: '/images/' + display.imageFolder + '/' + display.imageFiles[0] + '.webp', checkInTime: display.checkInTime, checkOutTime: display.checkOutTime, address: publicGuide?.address || display.addressKo, addressEn: publicGuide?.addressEn || display.addressKo, region: display.region };
}
function previewStay(language: GuestLanguage): GuestStayDTO {
  const t = guestStayTranslation(language);
  const day = todayKst();
  return { property: fallbackProperty('hwayeonjae'), guestName: t.sampleGuest, checkIn: day, checkOut: addDaysToDateStr(day, 3), guests: 2, phase: 'staying', expiresAt: new Date(Date.now() + 86400000 * 3).toISOString(), room: null, requests: [
    { id: '00000000-0000-4000-8000-000000000001', kind: 'taxi', status: 'confirmed', details: { date: addDaysToDateStr(day, 1), time: '09:30', destination: 'Incheon Airport · Terminal 1', passengers: 2, luggage: 2, note: '' }, publicReply: t.sampleReply, source: 'mobile', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
    { id: '00000000-0000-4000-8000-000000000002', kind: 'help', status: 'requested', details: { category: 'supplies', message: t.sampleHelp }, publicReply: '', source: 'pad', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
  ] };
}
export default function GuestStayApp({ slug, initialLanguage, preview = false }: { slug: string; initialLanguage: GuestLanguage; preview?: boolean }) {
  const incomingQuery = useSearchParams();
  const incomingInvitation = incomingQuery.get('invitation');
  const incomingAccessToken = incomingQuery.get('accessToken');
  const [lang, setLang] = useState(initialLanguage);
  const t = guestStayTranslation(lang);
  const [property, setProperty] = useState(() => fallbackProperty(slug));
  const [stay, setStay] = useState<GuestStayDTO | null>(() => preview ? previewStay(initialLanguage) : null);
  const [csrfToken, setCsrfToken] = useState('');
  const [loading, setLoading] = useState(!preview);
  const [loadError, setLoadError] = useState(false);
  const [credentials, setCredentials] = useState<Credentials>({});
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const [service, setService] = useState<Service | null>(null);
  const [notice, setNotice] = useState('');
  const [requestsBusy, setRequestsBusy] = useState(false);
  const [requestsError, setRequestsError] = useState(false);
  const [sections, setSections] = useState<GuideSection[]>([]);
  const [guideBusy, setGuideBusy] = useState(false);
  const [guideError, setGuideError] = useState(false);
  const [guideRetry, setGuideRetry] = useState(0);
  const [copySuccess, setCopySuccess] = useState('');
  const [tours, setTours] = useState<Tour[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [tourDetail, setTourDetail] = useState<TourDetail | null>(null);
  const [tourBusy, setTourBusy] = useState(false);
  const [tourError, setTourError] = useState(false);
  const [tourRetry, setTourRetry] = useState(0);
  const [tourId, setTourId] = useState('');
  const [durationOptionId, setDurationOptionId] = useState('');
  const [ticketCounts, setTicketCounts] = useState<Record<string, number>>({});
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [people, setPeople] = useState(2);
  const [bags, setBags] = useState(0);
  const [destination, setDestination] = useState('');
  const [taxiType, setTaxiType] = useState<'local' | 'airport'>('local');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState<'supplies' | 'issue' | 'other'>('supplies');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const sendLock = useRef(false);
  const pendingRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const loginLock = useRef(false);
  const explicitGrant = useRef(false);
  const headerRef = useRef<HTMLHeadingElement>(null);
  const signedIn = Boolean(stay);
  const propertyName = lang === 'ko' ? property.name : property.nameEn;

  const showApiError = useCallback((error: unknown, login = false) => {
    const current = guestStayTranslation(lang);
    if (error instanceof ApiError && error.status === 429) return current.rateError;
    if (error instanceof ApiError && error.status === 401) {
      if (!login) { explicitGrant.current = true; setStay(null); setCsrfToken(''); setAuthMessage(current.expired); }
      return login ? current.loginError : current.expired;
    }
    if (error instanceof ApiError && [400, 403].includes(error.status) && login) return current.loginError;
    if (error instanceof ApiError && error.status === 400) return current.inputError;
    if (error instanceof ApiError && error.status === 403) return current.refreshNeeded;
    return current.connectionError;
  }, [lang]);

  const loadSession = useCallback(async (signal?: AbortSignal) => {
    if (preview) return;
    setLoading(true); setLoadError(false);
    const results = await Promise.allSettled([
      api<{ property: GuestStayPropertyDTO }>('/api/public/guest-stay/config?slug=' + encodeURIComponent(slug), undefined, signal),
      explicitGrant.current ? Promise.resolve(null) : api<SessionResponse>('/api/public/guest-stay/session?slug=' + encodeURIComponent(slug), csrfToken ? { headers: { 'x-guest-csrf': csrfToken } } : undefined, signal),
    ]);
    if (signal?.aborted) return;
    if (results[0].status === 'fulfilled') setProperty(results[0].value.property);
    else setLoadError(true);
    if (results[1].status === 'fulfilled' && results[1].value && results[1].value.stay.property.slug === slug && !explicitGrant.current) {
      setStay(results[1].value.stay); setCsrfToken(results[1].value.csrfToken); setProperty(results[1].value.stay.property);
    } else if (results[1].status === 'rejected') {
      if (results[1].reason instanceof ApiError && results[1].reason.status === 401) {
        if (csrfToken) showApiError(results[1].reason);
      } else setLoadError(true);
    }
    setLoading(false);
  }, [preview, slug, csrfToken, showApiError]);

  useEffect(() => {
    if (preview) return;
    const query = new URL(window.location.href);
    const invitation = query.searchParams.get('invitation') || undefined;
    const accessToken = query.searchParams.get('accessToken') || undefined;
    // Capture in memory, then remove capabilities before any external navigation.
    if (invitation || accessToken) {
      explicitGrant.current = true;
      setStay(null); setCsrfToken('');
      setCredentials(invitation ? { invitation } : { accessToken });
      query.searchParams.delete('invitation'); query.searchParams.delete('accessToken');
      window.history.replaceState(window.history.state, '', query.pathname + query.search + query.hash);
    }
    const abort = new AbortController();
    void loadSession(abort.signal);
    return () => abort.abort();
  }, [preview, loadSession, incomingInvitation, incomingAccessToken]);

  useEffect(() => {
    if (!stay || preview) return;
    const end = Date.parse(stay.expiresAt);
    if (!Number.isFinite(end)) return;
    const expire = () => { explicitGrant.current = true; setStay(null); setCsrfToken(''); setAuthMessage(guestStayTranslation(lang).expired); };
    let timer = 0;
    const checkExpiry = () => {
      const remaining = end - Date.now();
      if (remaining <= 0) expire();
      else timer = window.setTimeout(checkExpiry, Math.min(remaining, 2147483647));
    };
    checkExpiry();
    return () => window.clearTimeout(timer);
  }, [stay, preview, lang]);

  const refreshRequests = useCallback(async () => {
    if (preview || !stay) return;
    setRequestsBusy(true); setRequestsError(false);
    try {
      const data = await api<{ requests: GuestStayRequestDTO[] }>('/api/public/guest-stay/requests', { headers: { 'x-guest-csrf': csrfToken } });
      setStay(current => current ? { ...current, requests: data.requests } : null);
    } catch (error) { showApiError(error); setRequestsError(true); }
    finally { setRequestsBusy(false); }
  }, [preview, stay, csrfToken, showApiError]);

  useEffect(() => {
    if (preview || !signedIn) return;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const result = await api<SessionResponse>('/api/public/guest-stay/session?slug=' + encodeURIComponent(slug), { headers: { 'x-guest-csrf': csrfToken } });
        setStay(result.stay); setCsrfToken(result.csrfToken);
      } catch (error) { if (error instanceof ApiError && error.status === 401) showApiError(error); }
    };
    const interval = window.setInterval(() => void refresh(), 60000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, [preview, signedIn, slug, csrfToken, showApiError]);

  useEffect(() => {
    if (tab !== 'guide' || !stay || stay.phase !== 'staying') { setSections([]); return; }
    const abort = new AbortController();
    setGuideBusy(true); setGuideError(false);
    if (preview) {
      // Preview only reads public demo sections, with no live reservation or API.
      import('@/lib/guest-stay-guide').then(module => {
        if (abort.signal.aborted) return;
        setSections(module.getGuestStayGuide(stay.property.slug, lang).sections);
        setGuideBusy(false);
      }).catch(() => { if (!abort.signal.aborted) { setGuideError(true); setGuideBusy(false); } });
    } else {
      api<{ sections: GuideSection[] }>('/api/public/guest-stay/guide?lang=' + lang, { headers: { 'x-guest-csrf': csrfToken } }, abort.signal).then(result => {
        if (!abort.signal.aborted) setSections(result.sections);
      }).catch(error => { if (!abort.signal.aborted) { showApiError(error); setGuideError(true); } }).finally(() => { if (!abort.signal.aborted) setGuideBusy(false); });
    }
    return () => abort.abort();
  }, [tab, signedIn, stay?.phase, stay?.property.slug, csrfToken, lang, preview, guideRetry, showApiError]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (service !== 'tour') return;
    const abort = new AbortController();
    // Preview reads the published catalogue too; only submitting remains local.
    setCatalogBusy(true); setCatalogError(false);
    api<Tour[]>('/api/public/tours', undefined, abort.signal).then(result => {
      if (!abort.signal.aborted) setTours(result);
    }).catch(() => { if (!abort.signal.aborted) setCatalogError(true); }).finally(() => { if (!abort.signal.aborted) setCatalogBusy(false); });
    return () => abort.abort();
  }, [service, tourRetry]);

  useEffect(() => {
    if (service !== 'tour' || !tourId) return;
    const chosen = tours.find(item => item.id === tourId);
    if (!chosen) return;
    const abort = new AbortController();
    setTourDetail(null); setTourBusy(true); setTourError(false);
    api<TourDetail>('/api/public/tours/' + encodeURIComponent(chosen.slug), undefined, abort.signal).then(result => {
      if (abort.signal.aborted) return;
      setTourDetail(result);
      setPeople(current => Math.min(current, result.maxGroupSize || 12, 12));
      setDurationOptionId(current => result.durationOptions.some(option => option.id === current) ? current : result.durationOptions[0]?.id || '');
      setTicketCounts(current => Object.fromEntries(result.ticketTiers.map(tier => [tier.id, current[tier.id] || 0])));
    }).catch(() => { if (!abort.signal.aborted) setTourError(true); }).finally(() => { if (!abort.signal.aborted) setTourBusy(false); });
    return () => abort.abort();
  }, [service, tourId, tours, tourRetry]);

  function chooseTour(id: string) {
    setTourId(id); setTourDetail(null); setTourBusy(Boolean(id)); setTourError(false);
    setDurationOptionId(''); setTicketCounts({}); setSendError('');
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => headerRef.current?.focus({ preventScroll: true }));
  }

  function go(next: Tab, chosenService: Service | null = null) {
    if (sendLock.current) return;
    if (chosenService === 'tour') chooseTour('');
    setTab(next); setService(chosenService); setSendError('');
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => headerRef.current?.focus({ preventScroll: true }));
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginLock.current) return;
    loginLock.current = true; setLoginBusy(true); setAuthMessage('');
    try {
      const result = await api<SessionResponse>('/api/public/guest-stay/login', json({ slug, name, ...(credentials.invitation || credentials.accessToken ? credentials : { code }) }));
      if (result.stay.property.slug !== slug) throw new ApiError(401);
      setStay(result.stay); setProperty(result.stay.property); setCsrfToken(result.csrfToken); setCredentials({}); setCode('');
      explicitGrant.current = false;
      if (!date && !time && !message && !note && !destination) setPeople(result.stay.guests || 2);
      go('home');
    } catch (error) { setAuthMessage(showApiError(error, true)); }
    finally { loginLock.current = false; setLoginBusy(false); }
  }
  async function logout() {
    if (preview) { setStay(null); setTab('home'); return; }
    try {
      await api('/api/public/guest-stay/logout', json({ csrfToken }));
      explicitGrant.current = true;
      setStay(null); setCsrfToken(''); setName(''); setMessage(''); setNote(''); setDestination(''); setConsent(false); setAuthMessage(''); setTab('home'); setService(null);
      pendingRequest.current = null;
    } catch (error) { setNotice(showApiError(error)); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stay || !service || sendLock.current) return;
    sendLock.current = true; setSending(true); setSendError('');
    const details = service === 'tour'
      ? { tourId, date, time, guests: tourDetail?.ticketTiers.length ? Object.values(ticketCounts).reduce((sum, value) => sum + value, 0) : people, ...(durationOptionId ? { durationOptionId } : {}), ...(tourDetail?.ticketTiers.length ? { ticketCounts: Object.fromEntries(Object.entries(ticketCounts).sort(([left], [right]) => left.localeCompare(right))) } : {}), note }
      : service === 'taxi' ? { date, time, destination, passengers: people, luggage: bags, note } : { category, message };
    const fingerprint = JSON.stringify({ kind: service, details });
    if (pendingRequest.current?.fingerprint !== fingerprint) pendingRequest.current = { fingerprint, id: crypto.randomUUID() };
    const input = { id: pendingRequest.current!.id, kind: service, details } as GuestStayRequestInput;
    try {
      let request: GuestStayRequestDTO;
      if (preview) {
        request = { ...input, ...(service === 'tour' && tourDetail ? { tourTitle: tourDetail.title, durationTitle: tourDetail.durationOptions.find(option => option.id === durationOptionId)?.label || undefined } : {}), status: 'requested', publicReply: '', source: 'mobile', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 };
      } else {
        const result = await api<{ request: GuestStayRequestDTO }>('/api/public/guest-stay/requests', json({ ...input, csrfToken }));
        request = result.request;
      }
      setStay(current => current ? { ...current, requests: [request, ...current.requests.filter(item => item.id !== request.id)] } : null);
      setNotice(preview ? t.previewReceived : t.received);
      setTime(''); setNote(''); setMessage(''); setDestination(''); setConsent(false);
      pendingRequest.current = null;
      setTab('requests'); setService(null); window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (error) { setSendError(showApiError(error)); }
    finally { sendLock.current = false; setSending(false); }
  }
  async function copy(value: string, key: string) {
    try { await navigator.clipboard.writeText(value); setCopySuccess(key); window.setTimeout(() => setCopySuccess(''), 2500); }
    catch { setCopySuccess(''); }
  }
  const earliestDate = stay ? [todayKst(), stay.checkIn].sort().at(-1) : todayKst();
  const title = tab === 'home' ? t.welcome : tab === 'guide' ? t.roomGuide : tab === 'requests' ? t.myRequests : service === 'tour' ? t.tours : service === 'taxi' ? t.taxi : service === 'help' ? t.help : t.services;
  const labelService = (kind: Service) => kind === 'tour' ? t.tours : kind === 'taxi' ? t.taxi : t.help;
  const chosenCourse = tourDetail?.durationOptions.find(option => option.id === durationOptionId);
  const ticketTotal = Object.values(ticketCounts).reduce((sum, value) => sum + value, 0);

  function Card({ icon, title, description, onClick, wide = false }: { icon: ReactNode; title: string; description: string; onClick: () => void; wide?: boolean }) {
    return <button type="button" className={styles.serviceCard + (wide ? ' ' + styles.wideCard : '')} onClick={onClick}><span className={styles.cardIcon}>{icon}</span><span className={styles.cardBody}><strong>{title}</strong><span>{description}</span></span><ChevronRight size={18} className={styles.cardArrow} aria-hidden="true" /></button>;
  }
  function ErrorBox({ text, retry }: { text: string; retry?: () => void }) {
    return <div className={styles.error} role="alert"><p>{text}</p>{retry && <button type="button" className={styles.textButton} onClick={retry}><RefreshCw size={15} />{t.retry}</button>}</div>;
  }
  const dateFields = <div className={styles.formGrid}><label>{t.date}<input type="date" required min={earliestDate} max={stay?.checkOut} value={date} onChange={event => setDate(event.target.value)} /></label><label>{t.time}<input type="time" required value={time} onChange={event => setTime(event.target.value)} /></label></div>;
  const peopleField = <label>{t.people}<select value={people} onChange={event => setPeople(Number(event.target.value))}>{Array.from({ length: Math.min(12, service === 'tour' ? tourDetail?.maxGroupSize || 12 : 12) }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label>;

  return <div className={styles.app} lang={lang} data-tab={tab}>
    <header className={styles.header}><a href={preview ? '/stay/preview' : '/stay/' + slug} aria-label="void anchae" className={styles.logoLink}><Logo variant="black" width={154} priority /></a><label className={styles.language}><span className={styles.srOnly}>{t.language}</span><select aria-label={t.language} value={lang} onChange={event => { const next = event.target.value as GuestLanguage; setLang(next); const url = new URL(window.location.href); url.searchParams.set('lang', next); window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash); }}>{guestLanguages.map(language => <option key={language} value={language}>{guestLanguageNames[language]}</option>)}</select></label></header>
    {preview && <div className={styles.preview}><span>{t.preview}</span><p>{t.previewNote}</p></div>}
    <main className={styles.main}>
      <div className={styles.pageHeading}>{service && <button type="button" className={styles.back} onClick={() => service === 'tour' && tourId ? chooseTour('') : go('services')} disabled={sending}><ArrowLeft size={17} />{service === 'tour' && tourId ? t.allTours : t.back}</button>}<p className={styles.eyebrow}>GUEST LOUNGE / {propertyName}</p><h1 ref={headerRef} tabIndex={-1}>{title}</h1><p className={styles.subtitle}>{tab === 'home' ? t.welcomeSub : tab === 'guide' ? t.guideIntro : tab === 'requests' ? t.privacy : service === 'tour' && !tourId ? t.tourCatalogIntro : t.requestIntro}</p></div>
      {notice && <div className={styles.notice} role="status"><Check size={19} /><p>{notice}</p><button type="button" onClick={() => setNotice('')} aria-label={t.back}>×</button></div>}
      {loadError && <ErrorBox text={t.error} retry={() => void loadSession()} />}
      {!stay && !loading && <section className={styles.loginCard} aria-labelledby="stay-login-title">
        <ShieldCheck size={25} /><h2 id="stay-login-title">{t.login}</h2><p>{credentials.invitation || credentials.accessToken ? t.qrIntro : t.loginIntro}</p>
        <form onSubmit={login}>
          <label>{t.name}<input name="guest-name" autoComplete="name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
          {!credentials.invitation && !credentials.accessToken && <label>{t.code}<input name="guest-stay-code" type="text" autoComplete="one-time-code" spellCheck={false} autoCapitalize="characters" required maxLength={40} value={code} onChange={event => setCode(event.target.value)} /><span className={styles.helper}>{t.codeHint}</span></label>}
          {authMessage && <ErrorBox text={authMessage} />}
          <button type="submit" className={styles.primary} disabled={loginBusy || preview}>{loginBusy ? <LoaderCircle size={17} className={styles.spin} /> : <ShieldCheck size={17} />}{loginBusy ? t.loading : t.enter}</button>
          {(credentials.invitation || credentials.accessToken) && <button type="button" className={styles.textButton} onClick={() => { setCredentials({}); setAuthMessage(''); }}>{t.useCode}</button>}
        </form>
        <p className={styles.helper}>{preview ? t.previewNote : t.noCode}</p>
      </section>}
      {loading && <div className={styles.sessionLoading} role="status"><LoaderCircle size={19} className={styles.spin} />{t.loading}</div>}
      {tab === 'home' && <>
        <div className={styles.hero}><Image src={property.image} alt={propertyName} fill priority sizes="(max-width: 680px) 100vw, 740px" unoptimized /><div className={styles.heroCaption}><p>{stay ? stay.phase === 'staying' ? t.staying : t.beforeArrival : 'VOID ANCHAE'}</p><h2>{propertyName}</h2></div></div>
        {stay && <section className={styles.stayCard} aria-label={t.login}><div className={styles.stayTop}><span><ShieldCheck size={15} />{preview ? t.sampleGuest : stay.guestName}</span><small>{Math.max(1, Math.round((Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86400000))} {t.nights}{stay.guests ? ' · ' + stay.guests + ' ' + t.guests : ''}</small></div><div className={styles.stayDates}><div><p>{t.checkin}</p><strong>{calendarDate(stay.checkIn, lang)}</strong><span>{property.checkInTime}</span></div><div className={styles.dateArrow}><ArrowUpRight size={21} /></div><div><p>{t.checkout}</p><strong>{calendarDate(stay.checkOut, lang)}</strong><span>{property.checkOutTime}</span></div></div></section>}
        <div className={styles.cardGrid}><Card icon={<Leaf size={23} strokeWidth={1.5} />} title={t.roomGuide} description={t.roomGuideSub} onClick={() => go('guide')} wide /><Card icon={<Sparkles size={22} strokeWidth={1.5} />} title={t.tours} description={t.tourSub} onClick={() => go('services', 'tour')} /><Card icon={<CarFront size={23} strokeWidth={1.5} />} title={t.taxi} description={t.taxiSub} onClick={() => go('services', 'taxi')} /><Card icon={<CircleHelp size={22} strokeWidth={1.5} />} title={t.help} description={t.helpSub} onClick={() => go('services', 'help')} wide /></div>
        {stay?.requests.length ? <button type="button" className={styles.requestShortcut} onClick={() => go('requests')}><ClipboardList size={19} /><span>{t.myRequests}<strong>{stay.requests.filter(request => !['completed', 'cancelled'].includes(request.status)).length}</strong></span><ChevronRight size={17} /></button> : null}
        <section className={styles.address}><MapPin size={21} /><div><h2>{t.address}</h2><p>{lang === 'ko' ? property.address : property.addressEn}</p><a href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(property.address)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t.map}<ArrowUpRight size={15} /></a></div></section>
      </>}
      {tab === 'guide' && <>
        <section className={styles.guideInfo}><CalendarDays size={20} /><div><p>{t.checkin}<strong>{property.checkInTime}</strong></p><p>{t.checkout}<strong>{property.checkOutTime}</strong></p></div></section>
        {!stay ? <p className={styles.softNote}>{t.guidePrivate}</p> : stay.phase === 'before_arrival' ? <p className={styles.softNote}>{t.prearrivalGuide}</p> : <>
          <section className={styles.wifi}><Wifi size={24} /><h2>{t.wifi}</h2>{stay.room?.wifiSsid ? <><div><p>{t.wifiName}</p><strong>{stay.room.wifiSsid}</strong><button type="button" onClick={() => void copy(stay.room!.wifiSsid, 'ssid')}><Copy size={15} />{copySuccess === 'ssid' ? t.copied : t.copy}</button></div><div><p>{t.wifiPassword}</p><strong>{stay.room.wifiPassword}</strong><button type="button" onClick={() => void copy(stay.room!.wifiPassword, 'password')}><Copy size={15} />{copySuccess === 'password' ? t.copied : t.copy}</button></div></> : <p className={styles.helper}>{t.noWifi}</p>}</section>
          {guideBusy && <p className={styles.sessionLoading} role="status"><LoaderCircle size={18} className={styles.spin} />{t.loading}</p>}
          {guideError && <ErrorBox text={t.error} retry={() => setGuideRetry(value => value + 1)} />}
          {!guideBusy && !guideError && !sections.length && <p className={styles.softNote}>{t.noRoomGuide}</p>}
          <div className={styles.guideSections}>{sections.map(section => <details key={section.id} className={styles.guideSection}><summary>{section.title}<ChevronRight size={17} /></summary><div>{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{section.images?.map(image => <a key={image.url} href={image.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><Image src={image.url} alt={image.alt} width={740} height={520} unoptimized className={styles.guideImage} /></a>)}</div></details>)}</div>
        </>}
        <div className={styles.guideLinks}>{guestGuide(slug) && <a href={'/guest/' + slug + '?lang=' + lang}>{t.generalGuide}<ArrowUpRight size={18} /></a>}<a href={property.slug === 'dowonjae' ? '/guide/yeongju?lang=' + lang : '/guide?lang=' + lang}>{t.localGuide}<ArrowUpRight size={18} /></a>{property.slug !== 'dowonjae' && <a href={'/guide/jongno-events?lang=' + lang}>{t.events}<ArrowUpRight size={18} /></a>}</div>
      </>}
      {tab === 'services' && !service && <><div className={styles.cardGrid}><Card icon={<Sparkles size={23} />} title={t.tours} description={t.tourSub} onClick={() => go('services', 'tour')} wide /><Card icon={<CarFront size={23} />} title={t.taxi} description={t.taxiSub} onClick={() => go('services', 'taxi')} wide /><Card icon={<CircleHelp size={23} />} title={t.help} description={t.helpSub} onClick={() => go('services', 'help')} wide /></div><p className={styles.softNote}>{t.requestNote}</p></>}
      {tab === 'services' && service === 'tour' && stay && !tourId && <section aria-label={t.allTours}>
        {catalogBusy && <p className={styles.sessionLoading} role="status"><LoaderCircle size={17} className={styles.spin} />{t.loading}</p>}
        {catalogError && <ErrorBox text={t.error} retry={() => setTourRetry(value => value + 1)} />}
        {!catalogBusy && !catalogError && !tours.length && <p className={styles.softNote}>{t.noTours}</p>}
        {!catalogError && <div className={styles.tourGrid}>{tours.map(tour => {
          const copy = guestTourCopy(tour, lang);
          return <button type="button" key={tour.id} className={styles.tourCard} onClick={() => chooseTour(tour.id)} aria-label={copy.title + ' · ' + t.viewProgram}>
            <span className={styles.tourPhoto}>{tour.images[0] ? <Image src={tour.images[0]} alt="" width={360} height={220} unoptimized /> : <Sparkles size={32} strokeWidth={1.2} />}</span>
            <span className={styles.tourCardBody}><strong>{copy.title}</strong><span className={styles.tourDescription}>{copy.description}</span><span className={styles.tourMeta}>{tour.durationMin ? <span><CalendarDays size={13} />{tour.durationMin} {t.minutes}</span> : null}{tour.basePrice !== null ? <span>{money(tour.basePrice, lang)}</span> : null}</span><span className={styles.tourCardAction}>{t.viewProgram}<ChevronRight size={15} /></span></span>
          </button>;
        })}</div>}
        <p className={styles.softNote}>{t.requestNote}</p>
      </section>}
      {tab === 'services' && service && stay && (service !== 'tour' || tourId) && <form className={styles.requestForm} onSubmit={submit}>
        <fieldset disabled={sending}><legend className={styles.srOnly}>{labelService(service)}</legend>
        {service === 'tour' && <>
          {tourBusy && <p className={styles.sessionLoading} role="status"><LoaderCircle size={17} className={styles.spin} />{t.loading}</p>}
          {tourError && <ErrorBox text={t.error} retry={() => setTourRetry(value => value + 1)} />}
          {tourDetail && <div className={styles.tourSummary}>{tourDetail.images[0] && <Image src={tourDetail.images[0]} alt={guestTourCopy(tourDetail, lang).title} width={620} height={330} unoptimized />}<h2>{guestTourCopy(tourDetail, lang).title}</h2><p>{guestTourCopy(tourDetail, lang).description?.split('\n').slice(0, 2).join(' ').slice(0, 280)}</p><a href={'/tours/' + encodeURIComponent(tourDetail.slug)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t.seeDetail}<ArrowUpRight size={15} /></a>
            {!!tourDetail.durationOptions.length && <label>{t.course}<select value={durationOptionId} required onChange={event => setDurationOptionId(event.target.value)}>{tourDetail.durationOptions.map(option => <option key={option.id} value={option.id}>{option.label || option.durationMin + ' ' + t.minutes}{option.label ? ' · ' + option.durationMin + ' ' + t.minutes : ''}{' · ' + money(option.price, lang)}</option>)}</select></label>}
            {tourDetail.ticketTiers.length > 0 && <div className={styles.ticketTiers}><p>{t.tierPrice}</p>{tourDetail.ticketTiers.map(tier => <div className={styles.ticketRow} key={tier.id}><span><strong>{tier.label}</strong><small>{tier.notes}{tier.notes ? ' · ' : ''}{money(tier.price, lang)}</small></span><div className={styles.stepper}><button type="button" aria-label={tier.label + ' −'} disabled={!ticketCounts[tier.id]} onClick={() => setTicketCounts(current => ({ ...current, [tier.id]: Math.max(0, (current[tier.id] || 0) - 1) }))}><Minus size={15} /></button><output aria-live="polite" aria-label={tier.label + ' ' + t.people}>{ticketCounts[tier.id] || 0}</output><button type="button" aria-label={tier.label + ' +'} disabled={ticketTotal >= Math.min(12, tourDetail.maxGroupSize || 12)} onClick={() => setTicketCounts(current => ({ ...current, [tier.id]: (current[tier.id] || 0) + 1 }))}><Plus size={15} /></button></div></div>)}</div>}
            <p className={styles.price}>{chosenCourse ? money(chosenCourse.price, lang) : tourDetail.basePrice !== null ? money(tourDetail.basePrice, lang) : t.priceConfirm}<small>{t.priceConfirm}</small></p>
          </div>}
        </>}
        {service !== 'help' && <>{dateFields}<div className={styles.formGrid}>{service === 'tour' && tourDetail?.ticketTiers.length ? <p className={styles.peopleTotal}>{t.people}: {ticketTotal}</p> : peopleField}{service === 'taxi' && <label>{t.bags}<select value={bags} onChange={event => setBags(Number(event.target.value))}>{Array.from({ length: 31 }, (_, index) => <option key={index} value={index}>{index}</option>)}</select></label>}</div></>}
        {service === 'taxi' && <><div className={styles.choiceRow}><button type="button" aria-pressed={taxiType === 'local'} onClick={() => setTaxiType('local')}>{t.localTaxi}</button><button type="button" aria-pressed={taxiType === 'airport'} onClick={() => setTaxiType('airport')}>{t.airport}</button></div><label>{t.destination}<input type="text" required maxLength={300} value={destination} placeholder={t.destinationHint} onChange={event => setDestination(event.target.value)} /></label><p className={styles.helper}>{taxiType === 'airport' ? t.airportHint : (lang === 'ko' ? property.address : property.addressEn)}</p></>}
        {service === 'help' ? <><label>{t.category}<select value={category} onChange={event => setCategory(event.target.value as typeof category)}><option value="supplies">{t.supplies}</option><option value="issue">{t.issue}</option><option value="other">{t.other}</option></select></label><label>{t.message}<textarea required maxLength={2000} rows={5} value={message} placeholder={t.messageHint} onChange={event => setMessage(event.target.value)} /></label></> : <label>{t.note}<textarea rows={3} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>}
        <p className={styles.softNote}>{service === 'help' ? t.bookChannel : t.requestNote}</p>
        {service === 'help' && stay.phase !== 'staying' && <p className={styles.error}>{t.helpAfterCheckin}</p>}
        <label className={styles.consent}><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} /><span>{t.consent}</span></label>
        {sendError && <ErrorBox text={sendError} retry={signedIn ? () => void loadSession() : undefined} />}
        <button type="submit" className={styles.primary} disabled={sending || (service === 'tour' && (!tourDetail || tourBusy || tourError || (tourDetail.ticketTiers.length > 0 && (ticketTotal < 1 || ticketTotal > 12)))) || (service === 'help' && stay.phase !== 'staying')}>{sending ? <LoaderCircle size={18} className={styles.spin} /> : <Check size={18} />}{sending ? t.submitting : t.submit}</button>
        <p className={styles.helper}>{t.allTimes}</p>
        </fieldset>
      </form>}
      {tab === 'requests' && stay && <>
        <div className={styles.requestTools}><p>{stay.requests.length} · {t.myRequests}</p><button type="button" onClick={() => void refreshRequests()} disabled={requestsBusy || preview}><RefreshCw size={16} className={requestsBusy ? styles.spin : ''} />{t.refresh}</button></div>
        {requestsError && <ErrorBox text={t.error} retry={() => void refreshRequests()} />}
        {!stay.requests.length && <div className={styles.empty}><ClipboardList size={34} strokeWidth={1.2} /><h2>{t.noRequests}</h2><p>{t.noRequestsSub}</p><button type="button" className={styles.primary} onClick={() => go('services')}>{t.services}<ArrowUpRight size={17} /></button></div>}
        <div className={styles.requestList}>{stay.requests.map(request => {
          const d = request.details;
          return <article key={request.id} className={styles.requestCard}><div className={styles.requestCardTop}><span className={styles.smallIcon}>{request.kind === 'taxi' ? <CarFront size={21} /> : request.kind === 'tour' ? <Sparkles size={21} /> : <CircleHelp size={21} />}</span><h2>{labelService(request.kind)}</h2><span className={styles.status} data-status={request.status}>{t[request.status]}</span></div>
            {'date' in d && <p className={styles.requestWhen}><CalendarDays size={15} />{calendarDate(d.date, lang)} · {d.time}</p>}
            {'destination' in d && <><p>{d.destination}</p><p className={styles.helper}>{d.passengers} {t.guests} · {t.bags} {d.luggage}</p></>}
            {'tourId' in d && <><p>{request.tourSnapshot?.title || request.tourTitle || tours.find(tour => tour.id === d.tourId)?.title || (preview ? t.sampleTour : t.tours)}</p><p className={styles.helper}>{request.tourSnapshot?.durationTitle || request.durationTitle}{(request.tourSnapshot?.durationTitle || request.durationTitle) ? ' · ' : ''}{d.guests} {t.guests}</p>{request.tourSnapshot?.ticketSelections.map(ticket => <p key={ticket.id} className={styles.helper}>{ticket.label} · {ticket.count} × {money(ticket.unitPrice, lang)}</p>)}{request.tourSnapshot?.price !== null && request.tourSnapshot?.price !== undefined && <p className={styles.helper}>{money(request.tourSnapshot.price, lang)} · {t.priceConfirm}</p>}</>}
            {'message' in d && <p>{d.message}</p>}
            {'note' in d && d.note && <p className={styles.helper}>{d.note}</p>}
            {request.publicReply && <div className={styles.hostReply}><p>{t.hostReply}</p><div>{request.publicReply}</div></div>}
            <footer>{new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(request.createdAt))}{request.source === 'pad' ? ' · ' + t.platform : ''}</footer>
          </article>;
        })}</div>
      </>}
      {!stay && !loading && tab === 'services' && <p className={styles.softNote}>{t.loginToRequest}</p>}
      {stay && <button className={styles.logout} type="button" disabled={sending} onClick={() => void logout()}><LogOut size={15} />{t.logout}</button>}
      <p className={styles.footer}>void anchae · {t.bookChannel}</p>
    </main>
    <nav className={styles.bottomNav} aria-label="Guest lounge">{([{ id: 'home', title: t.home, icon: <Home size={21} /> }, { id: 'guide', title: t.guide, icon: <Leaf size={21} /> }, { id: 'services', title: t.services, icon: <Sparkles size={21} /> }, { id: 'requests', title: t.myRequests, icon: <ClipboardList size={21} /> }] as { id: Tab; title: string; icon: ReactNode }[]).map(item => <button type="button" key={item.id} onClick={() => go(item.id)} disabled={sending} aria-current={tab === item.id ? 'page' : undefined}>{item.icon}<span>{item.title}</span>{item.id === 'requests' && stay?.requests.some(request => request.status === 'requested' || request.status === 'reviewing') && <i aria-hidden="true" />}</button>)}</nav>
  </div>;
}
