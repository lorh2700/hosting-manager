'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import styles from './BookingPhotoGallery.module.css';

export function BookingPhotoGallery({ images, name, english, variant = 'hero' }: { images: string[]; name: string; english: boolean; variant?: 'hero' | 'content' }) {
  const [view, setView] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const wheelAt = useRef(0);
  const open = view !== null;
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; opener.current?.focus({ preventScroll: true }); };
  }, [open]);
  if (!images.length) return null;
  const current = Math.min(selected, images.length - 1);
  const dotStart = Math.max(0, Math.min(current - 2, images.length - 6));
  const visibleDots = images.slice(dotStart, dotStart + 6);
  const move = (delta: number) => setView(value => typeof value === 'number' ? (value + delta + images.length) % images.length : value);
  const moveSelected = (delta: number) => setSelected(value => (value + delta + images.length) % images.length);
  const imageLabel = (i: number) => `${name} · ${english ? 'Photo' : '사진'} ${i + 1}`;
  const touchStart = (event: TouchEvent) => { touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; };
  const swipe = (event: TouchEvent, change: (delta: number) => void) => {
    const start = touch.current; touch.current = null;
    if (!start) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) change(dx > 0 ? -1 : 1);
  };
  return <section aria-label={english ? 'Property photos' : '숙소 사진'} className={`${styles.gallery} ${variant === 'hero' ? 'mx-auto max-w-7xl px-0 pt-20 sm:px-6 sm:pt-24' : 'scroll-mt-24'}`} id="stay-gallery">
    <div className="relative aspect-[4/3] overflow-hidden bg-stone-900 sm:aspect-[16/9] sm:rounded-xl" onTouchStart={touchStart} onTouchEnd={event => swipe(event, moveSelected)} onWheel={event => {
      if (Math.abs(event.deltaX) < 30 || Math.abs(event.deltaX) < Math.abs(event.deltaY) || Date.now() - wheelAt.current < 350) return;
      wheelAt.current = Date.now(); moveSelected(event.deltaX > 0 ? 1 : -1);
    }}>
      <button ref={opener} type="button" onClick={() => setView(current)} aria-label={`${imageLabel(current)} ${english ? 'enlarge' : '크게 보기'}`} className="absolute inset-0">
        <Image unoptimized={images[current].startsWith('https://')} src={images[current]} alt={imageLabel(current)} fill sizes="(min-width:1280px) 1232px, 100vw" priority={current === 0 && variant === 'hero'} className="object-cover" />
      </button>
      {images.length > 1 && <>
        <button type="button" onClick={() => moveSelected(-1)} aria-label={english ? 'Previous gallery photo' : '갤러리 이전 사진'} className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-stone-950/85 text-white sm:left-4"><ChevronLeft /></button>
        <button type="button" onClick={() => moveSelected(1)} aria-label={english ? 'Next gallery photo' : '갤러리 다음 사진'} className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-stone-950/85 text-white sm:right-4"><ChevronRight /></button>
      </>}
      <span aria-live="polite" className="absolute bottom-3 right-3 bg-stone-950/90 px-3 py-2 text-sm text-white">{current + 1} / {images.length}</span>
    </div>
    {images.length > 1 && <div aria-label={english ? 'Choose photo' : '갤러리 사진 선택'} className="flex flex-wrap justify-center px-2">
      {visibleDots.map((src, index) => { const i = dotStart + index; return <button type="button" key={`${src}-${i}`} aria-label={imageLabel(i)} aria-pressed={current === i} onClick={() => setSelected(i)} className="flex h-11 w-11 items-center justify-center"><span className={`h-1.5 rounded-full ${current === i ? 'w-5 bg-stone-100' : 'w-1.5 bg-stone-400'}`} /></button>; })}
    </div>}
    <dialog ref={dialog} onCancel={() => setView(null)} onClose={() => setView(null)} aria-label={english ? `${name} photos` : `${name} 사진 보기`} onKeyDown={event => {
      if (typeof view !== 'number') return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); }
    }} className="fixed inset-0 m-0 h-[100dvh] max-h-none w-full max-w-none bg-stone-950 p-0 text-white backdrop:bg-black/80">
      <div className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-3 border-b border-stone-700 bg-stone-950 px-4 sm:px-8">
        <span className="min-w-0 break-words text-sm">{name}{typeof view === 'number' ? ` · ${view + 1} / ${images.length}` : ''}</span>
        <button type="button" autoFocus onClick={() => setView(null)} className="flex min-h-11 shrink-0 items-center gap-2 px-2 text-sm" aria-label={english ? 'Close photos' : '사진 닫기'}><X size={20} />{english ? 'Close' : '닫기'}</button>
      </div>
      {typeof view === 'number' && <div className="relative h-[calc(100dvh-4rem)]" onTouchStart={touchStart} onTouchEnd={event => swipe(event, move)}>
        <Image unoptimized={images[view].startsWith('https://')} src={images[view]} alt={imageLabel(view)} fill sizes="100vw" className="object-contain p-2 sm:p-12" />
        {images.length > 1 && <>
          <button type="button" onClick={() => move(-1)} aria-label={english ? 'Previous photo' : '이전 사진'} className="absolute left-2 top-1/2 flex h-11 w-11 items-center justify-center rounded-full bg-stone-950/85 sm:left-6"><ChevronLeft /></button>
          <button type="button" onClick={() => move(1)} aria-label={english ? 'Next photo' : '다음 사진'} className="absolute right-2 top-1/2 flex h-11 w-11 items-center justify-center rounded-full bg-stone-950/85 sm:right-6"><ChevronRight /></button>
        </>}
      </div>}
    </dialog>
  </section>;
}
