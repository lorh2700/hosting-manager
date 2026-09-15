'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Compass, MapPin, Search, Utensils } from 'lucide-react';
import { usePublicLanguage } from '@/components/PublicLanguage';
import { guideEntries, RESTAURANT_SOURCE, type GuideCategory } from '@/lib/bukchon-guide';

export default function BukchonGuide() {
  const { language } = usePublicLanguage();
  const en = language === 'en';
  const [category, setCategory] = useState<GuideCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const categories = [{ id: 'all', ko: '전체', en: 'All' }, { id: 'food', ko: '맛집', en: 'Food' }, { id: 'tour', ko: '투어', en: 'Tours' }, { id: 'place', ko: '여행지', en: 'Places' }] as const;
  const filtered = guideEntries.filter(entry => (category === 'all' || entry.category === category) && [entry.name.ko, entry.name.en, entry.tag.ko, entry.tag.en, entry.description.ko, entry.description.en].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  return <main className="min-h-screen bg-[#f4f0e8] text-stone-900">
    <header className="bg-[#252e29] px-6 pb-16 pt-32 text-[#f4f0e8] md:px-12 md:pb-24 md:pt-40">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs tracking-[0.3em] text-[#c3cdbb]">THE NEIGHBORHOOD / BUKCHON</p>
        <h1 className="brand-serif mt-7 text-4xl leading-snug md:text-6xl">{en ? <>A little closer<br />to Bukchon.</> : <>머무는 곳 너머,<br />북촌을 만나다.</>}</h1>
        <div className="mt-8 flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <p className="max-w-lg text-sm leading-7 text-stone-300">{en ? 'A warm meal, a walk through old lanes, a new discovery. Explore food, tours and places around Bukchon.' : '따뜻한 한 끼, 오래된 골목의 산책, 처음 만나는 풍경. 북촌과 주변의 맛집부터 투어와 여행지까지 모았습니다.'}</p>
          <span className="text-xs tracking-widest text-[#c3cdbb]">SEOUL · LOCAL GUIDE</span>
        </div>
      </div>
    </header>
    <section aria-label={en ? 'Explore the guide' : '북촌 가이드 둘러보기'} className="mx-auto max-w-6xl px-6 py-10 md:px-8 md:py-14">
      <div className="flex flex-col justify-between gap-6 border-b border-stone-300 pb-7 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-2" role="group" aria-label={en ? 'Categories' : '분류'}>{categories.map(item => <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => setCategory(item.id)} className={`min-h-11 rounded-full border px-5 text-sm transition-colors ${category === item.id ? 'border-[#252e29] bg-[#252e29] text-white' : 'border-stone-300 hover:border-stone-600'}`}>{item[language]} <span className="ml-1 opacity-60">{item.id === 'all' ? guideEntries.length : guideEntries.filter(entry => entry.category === item.id).length}</span></button>)}</div>
        <label className="flex items-center gap-3 border-b border-stone-500 py-3"><Search size={17} aria-hidden="true" /><span className="sr-only">{en ? 'Search places or food' : '장소명 또는 음식 검색'}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={en ? 'Search places or food' : '장소명 또는 음식 검색'} className="w-full bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-stone-500 lg:w-52" /></label>
      </div>
      <p role="status" className="my-6 text-xs text-stone-500">{en ? `${filtered.length} places & experiences` : `${filtered.length}개의 장소와 경험`}</p>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{filtered.map(entry => {
        const Icon = entry.category === 'food' ? Utensils : entry.category === 'tour' ? Compass : MapPin;
        const external = entry.href.startsWith('https://');
        return <article key={entry.id} className="flex flex-col border border-stone-300 bg-[#faf8f3] p-6 md:p-7">
          <div className="mb-8 flex items-center justify-between text-[#65725e]"><Icon size={24} strokeWidth={1.3} aria-hidden="true" /><span className="text-xs">{entry.tag[language]}</span></div>
          <h2 className="brand-serif text-xl">{entry.name[language]}</h2>
          {!en && <p className="mt-1 text-xs text-stone-500">{entry.name.en}</p>}
          <p className="mb-8 mt-4 text-sm leading-7 text-stone-600">{entry.description[language]}</p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4">
            <Link href={entry.href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} className="inline-flex min-h-11 items-center gap-2 text-sm underline-offset-4 hover:underline" aria-label={`${entry.name[language]} · ${entry.category === 'food' ? (en ? 'Open map' : '지도 보기') : (en ? 'View details' : '안내 보기')}${external ? (en ? ' (new tab)' : ' (새 창)') : ''}`}>{entry.category === 'food' ? (en ? 'Open map' : '지도 보기') : (en ? 'View details' : '안내 보기')}<ArrowUpRight size={16} aria-hidden="true" /></Link>
            <span className="text-[11px] text-stone-500">{entry.category === 'food' ? (en ? 'Naver Map' : '네이버 지도') : entry.id === 'anchae-tours' ? 'void anchae' : (en ? 'Official guide' : '공식 안내')}</span>
          </div>
        </article>;
      })}</div>
      {!filtered.length && <div className="py-16 text-center"><p className="text-stone-600">{en ? 'No matches. Try another name or category.' : '검색 결과가 없습니다. 다른 이름이나 분류로 찾아보세요.'}</p><button type="button" onClick={() => { setQuery(''); setCategory('all'); }} className="mt-5 min-h-11 underline">{en ? 'Show all' : '전체 보기'}</button></div>}
      <aside className="mt-12 border-t border-stone-300 pt-8 text-sm leading-7 text-stone-600">
        <h2 className="font-medium text-stone-900">{en ? 'Before you go' : '방문 전 확인해 주세요'}</h2>
        <p className="mt-2">{en ? 'Check current hours, closures and booking availability through the linked map or official guide. Bukchon is a residential neighborhood: walk quietly and follow posted visiting restrictions.' : '영업시간·휴무·예약 가능 여부는 연결된 지도와 공식 안내에서 확인해 주세요. 북촌은 주민이 생활하는 마을입니다. 조용히 걸으며 현장의 방문시간 및 출입 안내를 따라 주세요.'}</p>
        <p className="mt-4 text-xs">{en ? 'Restaurant selection: ' : '맛집 목록 출처: '}<a href={RESTAURANT_SOURCE} target="_blank" rel="noopener noreferrer" className="underline">Restaurant Recommendations</a>{en ? ' · Tourism information: ' : ' · 관광정보: '}<a href="https://hanok.seoul.go.kr/front/kor/town/town01.do" target="_blank" rel="noopener noreferrer" className="underline">{en ? 'Seoul Hanok Portal' : '서울한옥포털'}</a> · <a href="https://korean.visitseoul.net/mvp/서울전통코스_/34902" target="_blank" rel="noopener noreferrer" className="underline">Visit Seoul</a></p>
      </aside>
    </section>
  </main>;
}
