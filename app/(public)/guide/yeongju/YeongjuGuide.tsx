'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight, MapPin, Utensils } from 'lucide-react';
import { usePublicLanguage } from '@/components/PublicLanguage';
import { YEONGJU_SOURCE, yeongjuEntries } from '@/lib/yeongju-guide';
import photoData from '@/lib/yeongju-guide-images.json';

type GuidePhoto = typeof photoData.sosu;
const photos: Partial<Record<string, GuidePhoto>> = photoData;

export default function YeongjuGuide() {
  const { language } = usePublicLanguage();
  const en = language === 'en';
  const [category,setCategory]=useState('all');
  const [query,setQuery]=useState('');
  const shown=yeongjuEntries.filter(e => (category==='all'||e.category===category)&&[e.nameKo,e.nameEn,e.tagKo,e.tagEn].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  return <main className="min-h-screen bg-[#f4f0e8] text-stone-900">
    <header className="bg-[#252e29] px-6 pb-16 pt-32 text-[#f4f0e8] md:px-12 md:pt-40">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
        <p className="text-xs tracking-[0.3em] text-[#c3cdbb]">THE NEIGHBORHOOD / YEONGJU</p>
        <h1 className="brand-serif mt-7 text-4xl leading-snug md:text-6xl">{en?'A little closer to Yeongju.':'산과 마을 사이, 영주를 만나다.'}</h1>
        <p className="mt-8 max-w-xl text-sm leading-7 text-stone-300">{en?'Traditional villages, quiet temple walks and a local meal. Explore the places, restaurants and cafés in our Yeongju guide.':'선비의 마을과 고즈넉한 사찰, 여행길에 만나는 한 끼. 영주의 여행지와 숙소 근처 맛집·카페를 모았습니다.'}</p>
        </div>
        <figure>
          <div className="relative aspect-[4/3] overflow-hidden" style={{borderRadius:'5rem 5rem 0 0'}}>
            <Image src={photoData.buseok.src} alt={en?'Buseoksa temple buildings surrounded by greenery':'초록 나무에 둘러싸인 영주 부석사 전각'} fill priority sizes="(min-width: 1024px) 520px, (min-width: 768px) 85vw, 100vw" className="object-cover" />
          </div>
          <figcaption className="mt-3 flex justify-between text-xs tracking-wide text-stone-300"><span>{en?'Buseoksa, Yeongju':'영주, 부석사'}</span><span>A QUIET MOMENT</span></figcaption>
        </figure>
      </div>
    </header>
    <section className="mx-auto max-w-6xl px-6 py-10 md:px-8">
      <nav aria-label={en?'Guide region':'가이드 지역'} className="mb-8 flex gap-2 text-sm">
        <Link href="/guide" className="rounded-full border border-stone-300 px-5 py-3">{en?'Bukchon':'북촌'}</Link>
        <Link href="/guide/yeongju" aria-current="page" className="rounded-full bg-[#252e29] px-5 py-3 text-white">{en?'Yeongju':'영주'}</Link>
      </nav>
      <div className="flex flex-col gap-4 border-b border-stone-300 pb-6 sm:flex-row sm:justify-between">
        <div className="flex flex-wrap gap-2">{[['all',en?'All':'전체'],['place',en?'Places':'여행지'],['food',en?'Food & cafés':'맛집·카페']].map(([id,label])=><button key={id} onClick={()=>setCategory(id)} aria-pressed={category===id} className={`min-h-11 rounded-full border px-4 text-sm ${category===id?'border-[#252e29] bg-[#252e29] text-white':'border-stone-300'}`}>{label} · {id==='all'?yeongjuEntries.length:yeongjuEntries.filter(e=>e.category===id).length}</button>)}</div>
        <input type="search" value={query} onChange={e=>setQuery(e.target.value)} aria-label={en?'Search places':'장소 검색'} placeholder={en?'Search places or food':'장소명 또는 음식 검색'} className="min-h-11 min-w-0 border-b border-stone-400 bg-transparent px-2 text-sm" />
      </div>
      <p role="status" className="my-6 text-xs text-stone-500">{shown.length}{en?' places':'개의 장소'}</p>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{shown.map(e=>{
        const Icon=e.category==='food'?Utensils:MapPin;
        const photo=photos[e.id];
        const referenceLabel=e.category==='food'?(en?'Food reference photo':'음식 참고 사진'):(en?'Reference photo':'참고 사진');
        const alt=photo?.reference?(e.id==='fox'?(en?'Korean fox — reference photo':'한국 여우 · 참고 사진'):e.id==='ginseng'?(en?'Ginseng root — reference photo':'인삼 뿌리 · 참고 사진'):`${en?e.tagEn:e.tagKo} · ${referenceLabel}`):(en?e.nameEn:e.nameKo);
        return <article key={e.id} className="group flex flex-col overflow-hidden border border-stone-300 bg-[#faf8f3]">
          {photo ? <div className="relative aspect-[4/3] overflow-hidden bg-stone-200">
            <Image src={photo.src} alt={alt} fill sizes="(min-width: 1024px) 350px, (min-width: 640px) 50vw, 100vw" style={e.id==='seonbi'||e.id==='museom'?{objectFit:'contain'}:undefined} className={`object-cover ${e.id==='seonbi'||e.id==='museom'?'':'motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-105'} ${e.id==='fox'?'object-bottom':''}`} />
            {photo.reference&&<span className="absolute bottom-3 left-3 rounded-full px-3 py-1.5 text-[11px] text-white" style={{backgroundColor:'rgba(0,0,0,0.68)'}}>{referenceLabel}</span>}
          </div> : <div className="flex aspect-[4/3] flex-col items-center justify-center gap-4 bg-[#e8eadd] text-[#65725e]" aria-hidden="true"><MapPin size={40} strokeWidth={1}/><span className="brand-serif text-2xl">{en?e.nameEn:e.nameKo}</span></div>}
          <div className="flex flex-1 flex-col p-6 md:p-7">
          <div className="mb-8 flex items-center justify-between gap-2 text-[#65725e]"><Icon size={24} strokeWidth={1.3}/><span className="text-xs">{en?e.tagEn:e.tagKo}</span></div>
          <h2 className="brand-serif text-xl">{en?e.nameEn:e.nameKo}</h2>
          {!en&&<p className="mt-1 text-xs text-stone-500">{e.nameEn}</p>}
          <p className="mb-8 mt-4 text-sm leading-7 text-stone-600">{en?e.descriptionEn:e.descriptionKo}</p>
          <a href={e.href} target="_blank" rel="noopener noreferrer" className="mt-auto inline-flex min-h-11 items-center justify-between gap-2 border-t border-stone-200 pt-4 text-sm" aria-label={`${en?e.nameEn:e.nameKo} · ${en?'View details (new tab)':'안내 보기 (새 창)'}`}>
            {e.category==='food'?(en?'Open map':'지도 보기'):e.id==='fox'?(en?'Source guide':'원문 안내 보기'):(en?'Guided tour information':'해설 예약 안내')}<ArrowUpRight size={16}/>
          </a>
          </div>
        </article>;
      })}</div>
      {!shown.length&&<p className="py-12 text-center text-stone-500">{en?'No matching places. Try another search.':'검색 결과가 없습니다. 다른 이름으로 검색해 주세요.'}</p>}
      <aside className="mt-12 border-t border-stone-300 py-8 text-sm leading-7 text-stone-600">
        <h2 className="font-medium">{en?'Before you go':'방문 전 확인해 주세요'}</h2>
        <p>{en?'Check current opening hours and tour availability at the linked destinations before visiting.':'방문 전 연결된 지도와 해설 예약 안내에서 영업시간·휴무·예약 가능 여부를 확인해 주세요.'}</p>
        <a href={YEONGJU_SOURCE} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block underline">{en?'Source: Yeongju travel guide':'출처: 영주 추천 여행지'}</a>
        <details className="mt-6 border-t border-stone-300 pt-4 text-xs">
          <summary className="w-fit cursor-pointer py-2">{en?'Photo credits':'사진 출처 및 이용 안내'}</summary>
          <p className="mt-3">{en?'Reference photos illustrate food, ginseng and wildlife; they do not show the listed businesses or facilities. Images are resized and cropped for the layout.':'참고 사진은 음식·인삼·여우를 소개하는 이미지이며, 해당 매장이나 시설의 실사진이 아닙니다. 사진은 화면에 맞춰 크기와 표시 영역을 조정했습니다.'}</p>
          <ul className="mt-3 space-y-2">{yeongjuEntries.filter(e=>photos[e.id]).map(e=>{const photo=photos[e.id]!;return <li key={e.id}><a href={photo.source} target="_blank" rel="noopener noreferrer" className="underline">{en?e.nameEn:e.nameKo}</a>{' — '}{photo.author}{' · '}<a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{photo.license}</a></li>;})}</ul>
        </details>
      </aside>
    </section>
  </main>;
}
