'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, CalendarDays, MapPin } from 'lucide-react';
import { NavigationLink } from '@/components/NavigationFeedback';
import { usePublicLanguage } from '@/components/PublicLanguage';
import { isJongnoDate, type JongnoEventDTO } from '@/lib/jongno-events';
import { JONGNO_CATEGORY_LABELS, JONGNO_AREA_LABELS, readJongnoEvents, jongnoCalendarHref, jongnoDateLabel,
  jongnoEventTitle, jongnoEventFee, jongnoRecommendationQuery, selectJongnoRecommendations } from '@/lib/jongno-events-view';

export interface JongnoEventRecommendationsProps {
  start?: string | null;
  end?: string | null;
  language?: 'ko' | 'en';
  className?: string;
}

/** A small, independent section: a failed culture lookup never blocks booking. */
export default function JongnoEventRecommendations({ start, end, language: explicitLanguage, className = '' }: JongnoEventRecommendationsProps) {
  const { language: defaultLanguage } = usePublicLanguage();
  const language = explicitLanguage ?? defaultLanguage;
  const en = language === 'en';
  const valid = isJongnoDate(start) && isJongnoDate(end) && start! <= end!;
  const query = jongnoRecommendationQuery(start, end);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; events: JongnoEventDTO[]; error: boolean } | null>(null);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let current = true;
    readJongnoEvents(query, controller.signal).then(data => {
      if (current) setResult({ key: query, events: selectJongnoRecommendations(data.events, start!, end!), error: false });
    }).catch(() => { if (current) setResult({ key: query, events: [], error: true }); })
      .finally(() => clearTimeout(timer));
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [query, start, end, retry]);
  const current = result?.key === query ? result : null;
  const loading = !!query && !current;
  const href = jongnoCalendarHref(start, end, language);
  return <section aria-label={en ? 'Culture during your stay' : '머무는 동안 만나는 종로'} className={`rounded-2xl border border-stone-200 bg-[#faf8f3] p-5 text-stone-900 sm:p-6 ${className}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[10px] tracking-[.2em] text-[#65725e]">JONGNO / WHAT’S ON</p><h2 className="brand-serif mt-2 text-xl">{en ? 'Culture during your stay' : '머무는 동안 만나는 종로'}</h2></div>
      <NavigationLink href={href} className="inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4">{en ? 'Full calendar' : '전체 문화 일정'}<ArrowUpRight size={15} aria-hidden="true" /></NavigationLink>
    </div>
    {valid && <p className="mt-3 text-xs text-stone-500">{jongnoDateLabel(start!, language)} – {jongnoDateLabel(end!, language)} · {en ? 'Includes check-out day' : '체크아웃 당일 포함'}</p>}
    {!query && <p className="mt-4 text-sm leading-6 text-stone-600">{valid ? (en ? 'Browse the calendar month by month for a longer stay.' : '긴 일정은 문화 달력에서 월별로 둘러보세요.') : (en ? 'Choose your stay dates to explore nearby cultural events.' : '투숙 날짜를 선택하면 주변 문화 일정을 함께 살펴볼 수 있습니다.')}</p>}
    {loading && <p role="status" className="mt-5 animate-pulse text-sm text-stone-500">{en ? 'Looking up cultural events…' : '문화 일정을 확인하고 있어요…'}</p>}
    {current?.error && <div className="mt-4 text-sm text-stone-600" role="status"><p>{en ? 'We couldn’t load cultural events. Your stay details are still available.' : '문화 일정을 불러오지 못했습니다. 예약 안내는 계속 이용하실 수 있습니다.'}</p><button type="button" onClick={() => { setResult(null); setRetry(value => value + 1); }} className="mt-2 min-h-11 underline underline-offset-4">{en ? 'Try again' : '다시 확인'}</button></div>}
    {current && !current.error && !current.events.length && <p className="mt-5 text-sm leading-6 text-stone-600">{en ? 'No verified events are listed for these dates yet. Browse the full calendar for other dates.' : '이 기간에 등록된 확인된 문화 일정이 아직 없습니다. 전체 달력에서 다른 날짜도 살펴보세요.'}</p>}
    {!!current?.events.length && <div className="mt-5 grid gap-3 lg:grid-cols-3">{current.events.map(event => <NavigationLink key={event.id} href={`${href}#event-${event.id}`} className="group rounded-xl border border-stone-200 bg-white p-4 transition-colors hover:border-[#65725e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#65725e]">
      <p className="text-xs text-[#65725e]">{JONGNO_CATEGORY_LABELS[event.category][language]} · {JONGNO_AREA_LABELS[event.area][language]}</p>
      <h3 className="mt-2 font-medium leading-6">{jongnoEventTitle(event, language)}</h3>
      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-stone-600"><CalendarDays size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{jongnoDateLabel(event.startDate, language)} – {jongnoDateLabel(event.endDate, language)}</p>
      <p className="mt-1 flex items-start gap-2 text-xs leading-5 text-stone-600"><MapPin size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{event.venue || JONGNO_AREA_LABELS[event.area][language]}</p>
      <p className="mt-3 text-xs text-stone-500">{jongnoEventFee(event, language)}{event.bookingRequired ? ` · ${en ? 'Booking required' : '사전 예약 필요'}` : ''}</p>
    </NavigationLink>)}</div>}
    {!!current?.events.length && <p className="mt-4 text-xs leading-5 text-stone-500">{en ? 'Check session times, closures and availability on the official page before visiting.' : '회차·휴관일·예약 가능 여부는 방문 전 공식 안내에서 확인해 주세요.'}</p>}
  </section>;
}
