'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import styles from './BookingPhotoGallery.module.css';

export function BookingPhotoGallery({ images, name, english, variant = 'hero' }: { images: string[]; name: string; english: boolean; variant?: 'hero' | 'content' }) {
  const [view, setView] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const [mobileIndex, setMobileIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const open = view !== null;
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  if (!images.length) return null;
  const move = (delta: number) => setView(value => typeof value === 'number' ? (value + delta + images.length) % images.length : value);
  const moveSelected = (delta: number) => setSelected(value => (value + delta + images.length) % images.length);
  const imageLabel = (i: number) => `${name} · ${english ? 'Photo' : '사진'} ${i + 1}`;
  return <section aria-label={english ? 'Property photos' : '숙소 사진'} className={variant === 'hero' ? 'mx-auto max-w-7xl px-0 pt-20 sm:px-6 sm:pt-24' : 'scroll-mt-24'} id={variant === 'content' ? 'stay-gallery' : undefined}>
    {variant === 'hero' ? <div className="relative">
      <div className="hidden h-[min(44vw,520px)] min-h-80 grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-2xl md:grid">
        {images.slice(0, 5).map((src, i) => <button type="button" key={src} onClick={() => setView(i)} aria-label={`${imageLabel(i)} ${english ? 'enlarge' : '크게 보기'}`} className={`group relative overflow-hidden bg-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] ${i === 0 ? 'col-span-2 row-span-2' : ''}`}>
          <Image src={src} alt={imageLabel(i)} fill sizes={i === 0 ? '(min-width: 1280px) 620px, 50vw' : '(min-width: 1280px) 310px, 25vw'} priority={i === 0} className="object-cover motion-safe:transition-transform motion-safe:duration-500 group-hover:scale-[1.03]" />
        </button>)}
      </div>
      <div className={`${styles.carousel} flex snap-x snap-mandatory overflow-x-auto md:hidden`} onScroll={event => { const el = event.currentTarget; setMobileIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}>
        {images.slice(0, 5).map((src, i) => <button type="button" key={src} onClick={() => setView(i)} aria-label={`${imageLabel(i)} ${english ? 'enlarge' : '크게 보기'}`} className="relative aspect-[4/3] w-full shrink-0 snap-center bg-stone-900">
          <Image src={src} alt={imageLabel(i)} fill sizes="100vw" priority={i === 0} className="object-cover" />
        </button>)}
      </div>
      <div className="absolute bottom-4 right-4 flex items-center gap-2">
        <span className="rounded-full bg-black/60 px-3 py-2 text-xs text-white md:hidden">{Math.min(mobileIndex + 1, 5, images.length)} / {Math.min(5, images.length)}</span>
      </div>
    </div> : <div>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-medium">{english ? 'Photo gallery' : '사진 갤러리'}</h2><span aria-live="polite" className="text-sm text-stone-400">{selected + 1} / {images.length}</span></div>
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-stone-900" onTouchStart={event => { touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }} onTouchEnd={event => { const start = touch.current; touch.current = null; if (!start) return; const dx = event.changedTouches[0].clientX - start.x; const dy = event.changedTouches[0].clientY - start.y; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) moveSelected(dx > 0 ? -1 : 1); }}>
        <button type="button" onClick={() => setView(selected)} aria-label={imageLabel(selected) + (english ? ' enlarge' : ' 크게 보기')} className="absolute inset-0"><Image src={images[selected]} alt={imageLabel(selected)} fill sizes="(max-width:1024px) 100vw, 720px" className="object-contain" /></button>
        <button type="button" onClick={() => moveSelected(-1)} aria-label={english ? 'Previous gallery photo' : '갤러리 이전 사진'} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-3"><ChevronLeft /></button>
        <button type="button" onClick={() => moveSelected(1)} aria-label={english ? 'Next gallery photo' : '갤러리 다음 사진'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-3"><ChevronRight /></button>
      </div>
      <div aria-label={english ? 'Choose photo' : '갤러리 사진 선택'} className={styles.carousel + ' mt-3 flex gap-2 overflow-x-auto pb-2'}>
        {images.map((src, i) => <button type="button" key={src} aria-label={imageLabel(i)} aria-pressed={selected === i} onClick={() => setSelected(i)} className={'relative h-16 w-24 shrink-0 overflow-hidden rounded-md border-2 ' + (selected === i ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100')}><Image src={src} alt="" fill sizes="96px" className="object-cover" /></button>)}
      </div>
    </div>}
    <dialog ref={dialog} onCancel={() => setView(null)} onClose={() => setView(null)} aria-label={english ? `${name} photos` : `${name} 사진 보기`} onKeyDown={event => {
      if (typeof view !== 'number') return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); }
    }} className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none bg-stone-950 p-0 text-white backdrop:bg-black/80">
      <div className="sticky top-0 z-10 flex min-h-16 items-center justify-between border-b border-stone-800 bg-stone-950 px-4 sm:px-8">
        <div className="flex items-center gap-4"><span className="text-sm">{name}{typeof view === 'number' ? ` · ${view + 1} / ${images.length}` : ` · ${images.length}`}</span>
          </div>
        <button type="button" autoFocus onClick={() => setView(null)} className="flex min-h-11 items-center gap-2 px-2 text-sm" aria-label={english ? 'Close photos' : '사진 닫기'}><X size={20} />{english ? 'Close' : '닫기'}</button>
      </div>
      {typeof view === 'number' && <div className="relative h-[calc(100dvh-4rem)]" onTouchStart={event => { touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }} onTouchEnd={event => { const start = touch.current; touch.current = null; if (!start) return; const dx = event.changedTouches[0].clientX - start.x; const dy = event.changedTouches[0].clientY - start.y; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? -1 : 1); }}>
        <Image src={images[view]} alt={imageLabel(view)} fill sizes="100vw" className="object-contain p-2 sm:p-12" />
        <button type="button" onClick={() => move(-1)} aria-label={english ? 'Previous photo' : '이전 사진'} className="absolute left-2 top-1/2 rounded-full bg-black/60 p-3 sm:left-6"><ChevronLeft /></button>
        <button type="button" onClick={() => move(1)} aria-label={english ? 'Next photo' : '다음 사진'} className="absolute right-2 top-1/2 rounded-full bg-black/60 p-3 sm:right-6"><ChevronRight /></button>
      </div>}
    </dialog>
  </section>;
}
