'use client';

import { useEffect, useState } from 'react';
import type { StayTour, StayTourSelectionInput, StayTourLanguage } from '@/lib/stay-tour-types';
import { estimatedTourPrice, tourSelectionIssue } from './tour-selection';
export { tourSelectionIssue } from './tour-selection';

type Props = { propertyId: string; checkIn: string; checkOut: string; guests: number; english: boolean; selections: StayTourSelectionInput[]; onChange: (value: StayTourSelectionInput[]) => void };
const field = 'w-full min-h-12 rounded-md border border-stone-500 bg-stone-950 px-3 py-2 text-base text-stone-100';

export default function StayTourSelector({ propertyId, checkIn, checkOut, guests, english, selections, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [tours, setTours] = useState<StayTour[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setError(''); setTours(null);
    fetch(`/api/public/stay-tours?${new URLSearchParams({ propertyId })}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.tours)) throw new Error('TOUR_CATALOG_UNAVAILABLE');
        if (!controller.signal.aborted) setTours(data.tours);
      }).catch(() => { if (!controller.signal.aborted) setError(english ? 'Tours could not be loaded. Please try again.' : '투어 목록을 불러오지 못했습니다. 다시 시도해 주세요.'); });
    return () => controller.abort();
  }, [propertyId, expanded, retry, english]);
  const update = (tourId: string, change: Partial<StayTourSelectionInput>) => onChange(selections.map(item => item.tourId === tourId ? { ...item, ...change } : item));
  const select = (tour: StayTour, checked: boolean) => {
    if (!checked) { onChange(selections.filter(item => item.tourId !== tour.id)); return; }
    const count = Math.min(guests, tour.maxGroupSize ?? guests);
    onChange([...selections, { tourId: tour.id, requestedDate: checkIn, requestedTime: '', guests: count, language: english ? 'en' : 'ko',
      ...(tour.durationOptions[0] ? { durationOptionId: tour.durationOptions[0].id } : {}),
      ...(tour.ticketTiers.length ? { tickets: tour.ticketTiers.map((tier, index) => ({ tierId: tier.id, count: index === 0 ? count : 0 })) } : {}) }]);
  };
  const issue = tourSelectionIssue(selections, checkIn, checkOut, guests, english);
  return <section id="stay-tours" className="scroll-mt-24 border-t border-stone-700 pt-8" aria-labelledby="stay-tours-title">
    <h2 id="stay-tours-title" className="font-serif text-2xl">{english ? 'Optional tours' : '옵션 투어'}</h2>
    <p className="mt-3 text-sm leading-6 text-stone-300">{english ? 'Request a tour alongside your stay. Your host will check the schedule and contact you to confirm and arrange separate payment.' : '숙박 예약과 함께 투어를 신청할 수 있습니다. 담당자가 일정을 확인한 뒤 투어 확정과 별도 결제를 안내합니다.'}</p>
    <p className="mt-2 text-sm text-stone-400">{english ? 'Tour fees are not included in the accommodation payment.' : '투어 비용은 숙박 결제금액에 포함되지 않습니다.'}</p>
    <button type="button" aria-expanded={expanded} aria-controls="stay-tour-options" onClick={() => setExpanded(value => !value)} className="my-4 flex min-h-12 items-center gap-3 rounded-md border border-stone-500 px-4 text-sm">{expanded ? english ? 'Close tour list' : '투어 목록 접기' : english ? 'Choose a tour' : '투어 선택하기'}{selections.length > 0 ? ` (${selections.length})` : ''}</button>
    <div id="stay-tour-options" hidden={!expanded}>
      {expanded && <>
        {error ? <div role="alert" className="space-y-2 text-sm text-amber-200"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-11 underline underline-offset-4">{english ? 'Reload tours' : '투어 다시 불러오기'}</button></div>
          : tours === null ? <p role="status" className="py-4 text-sm text-stone-300">{english ? 'Loading tour options…' : '신청할 수 있는 투어를 불러오고 있습니다…'}</p>
          : tours.length === 0 ? <p className="py-4 text-sm leading-6 text-stone-300">{english ? 'There are no tours available to request for this stay at the moment.' : '현재 이 숙소에서 신청할 수 있는 투어가 없습니다.'}</p>
          : <div className="divide-y divide-stone-700">{tours.map(tour => {
            const selected = selections.find(item => item.tourId === tour.id);
            const limit = Math.min(guests, tour.maxGroupSize ?? guests);
            const price = selected ? estimatedTourPrice(tour, selected) : null;
            return <article key={tour.id} className="py-6">
              <label className="flex min-h-12 cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-stone-100" checked={!!selected} disabled={!selected && selections.length >= 3} onChange={event => select(tour, event.target.checked)} />
                <span><span className="block text-lg text-stone-100">{tour.title}</span><span className="mt-1 block text-sm text-stone-300">{tour.durationMin ? english ? `${tour.durationMin} minutes` : `${tour.durationMin}분` : english ? 'Duration confirmed on request' : '소요 시간 별도 안내'}{tour.maxGroupSize ? english ? ` · Up to ${tour.maxGroupSize} people` : ` · 최대 ${tour.maxGroupSize}인` : ''}</span></span>
              </label>
              {tour.description && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-stone-300">{tour.description}</p>}
              {selected && <fieldset className="mt-5 space-y-4 rounded-md border border-stone-600 p-4">
                <legend className="px-2 text-sm">{english ? 'Preferred tour details' : '투어 희망 일정'}</legend>
                {tour.durationOptions.length > 0 && <div><label htmlFor={`tour-course-${tour.id}`} className="mb-2 block text-sm text-stone-300">{english ? 'Course' : '코스'}</label><select id={`tour-course-${tour.id}`} className={field} value={selected.durationOptionId} onChange={event => update(tour.id, { durationOptionId: event.target.value })}>{tour.durationOptions.map(option => <option key={option.id} value={option.id}>{option.label || `${option.durationMin}${english ? ' min' : '분'}`}{tour.ticketTiers.length === 0 ? ` · ₩${option.price.toLocaleString()}/${english ? 'person' : '인'}` : ''}</option>)}</select>{tour.ticketTiers.length > 0 && <p className="mt-2 text-sm text-stone-300">{english ? 'The tour fee is calculated from your selected tickets.' : '요금은 선택한 티켓을 기준으로 계산합니다.'}</p>}</div>}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><label htmlFor={`tour-date-${tour.id}`} className="mb-2 block text-sm text-stone-300">{english ? 'Preferred date' : '희망 날짜'}</label><input id={`tour-date-${tour.id}`} className={field} type="date" min={checkIn || undefined} max={checkOut || undefined} value={selected.requestedDate} onChange={event => update(tour.id, { requestedDate: event.target.value })} /></div>
                  <div><label htmlFor={`tour-time-${tour.id}`} className="mb-2 block text-sm text-stone-300">{english ? 'Preferred time' : '희망 시간'}</label><input id={`tour-time-${tour.id}`} className={field} type="time" value={selected.requestedTime} onChange={event => update(tour.id, { requestedTime: event.target.value })} /></div>
                  <div><label htmlFor={`tour-guests-${tour.id}`} className="mb-2 block text-sm text-stone-300">{english ? 'Participants' : '투어 인원'}</label><select id={`tour-guests-${tour.id}`} className={field} value={selected.guests} onChange={event => update(tour.id, { guests: Number(event.target.value) })}>{Array.from({ length: Math.max(limit, selected.guests) }, (_, i) => <option key={i + 1} value={i + 1} disabled={i + 1 > limit}>{i + 1}{english ? ' people' : '인'}</option>)}</select></div>
                  <div><label htmlFor={`tour-language-${tour.id}`} className="mb-2 block text-sm text-stone-300">{english ? 'Guide language requested' : '희망 안내 언어'}</label><select id={`tour-language-${tour.id}`} className={field} value={selected.language} onChange={event => update(tour.id, { language: event.target.value as StayTourLanguage })}><option value="ko">한국어</option><option value="en">English</option><option value="zh">中文</option><option value="ja">日本語</option></select></div>
                </div>
                {tour.ticketTiers.length > 0 && <div className="space-y-3"><p className="text-sm text-stone-300">{english ? 'Tickets (one per participant)' : '티켓 선택 (인원별 1매)'}</p>{tour.ticketTiers.map(tier => <div key={tier.id} className="grid grid-cols-[1fr_5rem] items-center gap-3"><label htmlFor={`tour-ticket-${tour.id}-${tier.id}`} className="text-sm leading-6">{tier.label} · ₩{tier.price.toLocaleString()}{tier.notes && <span className="block text-stone-400">{tier.notes}</span>}</label><select id={`tour-ticket-${tour.id}-${tier.id}`} className={field} value={selected.tickets?.find(ticket => ticket.tierId === tier.id)?.count ?? 0} onChange={event => update(tour.id, { tickets: tour.ticketTiers.map(item => ({ tierId: item.id, count: item.id === tier.id ? Number(event.target.value) : selected.tickets?.find(ticket => ticket.tierId === item.id)?.count ?? 0 })) })}>{Array.from({ length: selected.guests + 1 }, (_, count) => <option key={count} value={count}>{count}</option>)}</select></div>)}</div>}
                <p className="border-t border-stone-700 pt-4 text-sm leading-6 text-stone-200">{price === null ? english ? 'Tour price will be provided after your request.' : '투어 금액은 신청 후 별도로 안내합니다.' : english ? `Estimated tour fee: ₩${price.toLocaleString()} (separate payment)` : `투어 예상 금액: ₩${price.toLocaleString()} (별도 결제)`}</p>
                <button type="button" className="min-h-11 text-sm underline underline-offset-4" onClick={() => select(tour, false)}>{english ? 'Remove this tour' : '이 투어 선택 취소'}</button>
              </fieldset>}
            </article>;
          })}</div>}
        {selections.length >= 3 && <p className="text-sm text-stone-300">{english ? 'You may request up to three tours.' : '투어는 최대 3개까지 신청할 수 있습니다.'}</p>}
      </>}
    </div>
    {issue && <p role="status" className="mt-3 text-sm leading-6 text-amber-200">{issue}</p>}
  </section>;
}
