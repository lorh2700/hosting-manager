const fs=require('fs');const p='app/(public)/book/[id]/page.tsx';let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
function cut(start,end,replacement=''){const a=s.indexOf(start),b=s.indexOf(end,a);if(a<0||b<0)throw Error(start);s=s.slice(0,a)+replacement+s.slice(b);}
s=s.replace('useState, useEffect, useRef, Suspense','useState, useEffect, Suspense').replace("import Image from 'next/image';","import { BookingPhotoGallery } from '@/components/BookingPhotoGallery';");
s=s.replace('  const [heroIndex, setHeroIndex] = useState(0);\n','');
cut('  // 갤러리 뷰어:', '  useEffect(() => {');
cut('  // 갤러리 조작:', '  const nextMonth');
cut('      {/* Hero Gallery Section */}', '      {/* Property Info Bar */}',`      <BookingPhotoGallery images={property.images?.length ? property.images : [property.imageUrl || '/images/main_yard.webp']} name={t(property.name)} english={language === 'en'} />
      <header id="stay-details" className="mx-auto max-w-7xl scroll-mt-24 px-4 pb-2 pt-8 sm:px-6 sm:pt-10">
        <p className="mb-3 text-xs uppercase tracking-[0.2em] text-stone-400">{property.region ? t(property.region) : 'void anchae'} · HANOK STAY</p>
        <h1 className="font-serif text-4xl font-light tracking-tight sm:text-5xl">{t(property.name)}</h1>
        {property.catchphrase && <p className="mt-4 text-lg text-stone-300">{t(property.catchphrase)}</p>}
        {property.addressKo && <a href="#stay-location" className="mt-3 inline-flex min-h-11 items-center text-sm text-stone-400 underline underline-offset-4">{property.addressKo}</a>}
      </header>

`);
cut('      {/* Photo Gallery Viewer', '      {property.status ===',`      <nav aria-label={language === 'en' ? 'Stay sections' : '숙소 상세 메뉴'} className="mx-auto flex max-w-7xl gap-6 overflow-x-auto border-b border-stone-800 px-4 text-sm sm:px-6">
        <a href="#stay-description" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'About the stay' : '숙소 소개'}</a>
        <a href="#booking-dates" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'Dates & rates' : '날짜·요금'}</a>
        <a href="#stay-location" className="flex min-h-14 shrink-0 items-center">{language === 'en' ? 'Location' : '위치 안내'}</a>
      </nav>
      <section id="stay-description" className="mx-auto max-w-7xl scroll-mt-24 px-4 pt-8 sm:px-6">
        <h2 className="mb-4 text-xl font-medium">{language === 'en' ? 'About the stay' : '숙소 소개'}</h2>
        <p className="max-w-3xl whitespace-pre-line text-sm leading-7 text-stone-300">{property.description ? t(property.description) : property.catchphrase ? t(property.catchphrase) : t(property.name)}</p>
      </section>

`);
cut('      {/* Lightbox —', '    </div>\n  );\n}',`      <section id="stay-location" className="mx-auto max-w-7xl scroll-mt-24 border-t border-stone-800 px-4 py-10 sm:px-6">
        <h2 className="mb-4 text-xl font-medium">{language === 'en' ? 'Location' : '위치 안내'}</h2>
        <p className="text-sm text-stone-300">{property.addressKo || (language === 'en' ? 'Please contact us for the exact address.' : '상세 위치는 숙소로 문의해 주세요.')}</p>
      </section>
      {property.status !== 'coming_soon' && <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-stone-700 bg-stone-950/95 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="min-w-0 text-sm"><p className="truncate">{t(property.name)}</p><p className="mt-1 text-xs text-stone-400">{checkIn && checkOut ? format(checkIn, 'M.d') + ' — ' + format(checkOut, 'M.d') : language === 'en' ? 'Choose dates to view rates' : '날짜 선택 후 요금 확인'}</p></div>
        <a href="#booking-dates" className="flex min-h-11 shrink-0 items-center rounded-lg bg-[#eee8dc] px-5 text-sm font-medium text-stone-950">{language === 'en' ? 'Dates & rates' : '날짜·요금 확인'}</a>
      </div>}
`);
s=s.replace('min-h-screen bg-[#0C0A09] text-stone-50 selection:', 'min-h-screen pb-24 lg:pb-0 bg-[#0C0A09] text-stone-50 selection:');
s=s.replace('max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 flex flex-wrap items-center justify-center','max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8 flex flex-wrap items-center');
s=s.replace('max-w-5xl mx-auto px-4 md:px-6 py-10 md:py-24 grid','max-w-7xl mx-auto px-4 md:px-6 py-10 md:py-12 grid');
s=s.replace('lg:sticky lg:top-24 space-y-8','lg:sticky lg:top-24 space-y-8 rounded-2xl border border-stone-700 bg-stone-900/40 p-5 sm:p-7');
fs.writeFileSync(p,s);
let d=fs.readFileSync('lib/property-display.ts','utf8');for(const key of ['anon','hwayeonjae','dowonjae']){const a=d.indexOf('  '+key+': {'),b=d.indexOf('    imageFiles:',a),end=d.indexOf('],',b)+2;d=d.slice(0,b)+`    imageFiles: [${Array.from({length:12},(_,i)=>"'gallery-"+String(i+1).padStart(2,'0')+"'").join(', ')}],`+d.slice(end);}
for(const line of ["      'DSC01646',   // 부엌 전체", "      'DSC01688',   // 샤워부스", "      'DSC06377',   // 도자기 오브제"])d=d.replace(line+'\r\n','').replace(line+'\n','');
fs.writeFileSync('lib/property-display.ts',d);
