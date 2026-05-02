'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Clock, Users, MapPin, Compass, Loader2, Menu, X } from 'lucide-react';
import { Logo } from '@/components/Logo';

interface PublicTour {
  id: string;
  title: string;
  slug: string;
  category: string | null;
  description: string | null;
  meetingPoint: string | null;
  durationMin: number | null;
  basePrice: number | null;
  maxGroupSize: number | null;
  images: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
  hanbok: '한복',
  guide: '가이드 투어',
  tea: '다도',
  craft: '공예',
  food: '음식',
  other: '기타',
};

const NAV_LINKS = [
  { href: '/#spaces', label: '공간' },
  { href: '/tours', label: '투어' },
  { href: '/about', label: '호스팅 지원 플랫폼' },
];

const SECONDARY_LINKS = [
  { href: 'https://lab.voidanchae.com', label: 'Lab', external: true },
  { href: '/admin', label: '관리자', external: false },
];

export default function PublicToursPage() {
  const [tours, setTours] = useState<PublicTour[]>([]);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/public/tours');
        if (res.ok) setTours(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-[#0C0A09] text-stone-50 selection:bg-stone-400/20 font-sans">
      {/* Navigation — matches home portal */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-stone-950/55 backdrop-blur-md border-b border-white/[0.06]">
        <div className="flex justify-between items-center px-6 md:px-8 h-16 md:h-[72px]">
          <Link href="/" className="flex items-center hover:opacity-80 transition-opacity" aria-label="void anchae 홈">
            <Logo width={140} priority />
          </Link>

          <div className="hidden md:flex items-center gap-7 text-xs uppercase tracking-widest font-medium text-stone-300">
            {NAV_LINKS.map(link => (
              <Link key={link.href} href={link.href} className="hover:text-white transition-colors min-h-[44px] inline-flex items-center">
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-2">
            {SECONDARY_LINKS.map(link => (
              link.external ? (
                <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="text-xs uppercase tracking-widest font-medium text-stone-200 bg-white/5 hover:bg-white/15 px-4 py-3 rounded-full transition-colors min-h-[44px] inline-flex items-center">
                  {link.label}
                </a>
              ) : (
                <Link key={link.href} href={link.href} className="text-xs uppercase tracking-widest font-medium text-stone-200 bg-white/5 hover:bg-white/15 px-4 py-3 rounded-full transition-colors min-h-[44px] inline-flex items-center">
                  {link.label}
                </Link>
              )
            ))}
          </div>

          <div className="md:hidden flex items-center gap-2">
            <button type="button" onClick={() => setMobileOpen(v => !v)} aria-label={mobileOpen ? '메뉴 닫기' : '메뉴 열기'} className="p-3 -mr-2 text-stone-200 hover:text-white min-h-[44px] min-w-[44px] inline-flex items-center justify-center">
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-white/[0.06] bg-stone-950/95 backdrop-blur-lg px-6 py-4 space-y-1">
            {NAV_LINKS.map(link => (
              <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)} className="block py-3 text-sm uppercase tracking-widest text-stone-200 hover:text-white min-h-[44px]">
                {link.label}
              </Link>
            ))}
            <div className="border-t border-white/[0.06] pt-2 mt-2 space-y-1">
              {SECONDARY_LINKS.map(link => (
                link.external ? (
                  <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)} className="block py-3 text-sm uppercase tracking-widest text-stone-300 hover:text-white min-h-[44px]">
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)} className="block py-3 text-sm uppercase tracking-widest text-stone-300 hover:text-white min-h-[44px]">
                    {link.label}
                  </Link>
                )
              ))}
            </div>
          </div>
        )}
      </nav>

      <header className="pt-32 md:pt-40 pb-12 px-6 md:px-12 max-w-[1400px] mx-auto text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-stone-400 mb-4">Bukchon Tours</p>
        <h1 className="text-4xl md:text-5xl font-light tracking-tight mb-5">북촌의 시간을 거닐다</h1>
        <p className="text-stone-300 max-w-xl mx-auto text-sm md:text-base font-light">
          한옥마을 주변의 한복, 가이드, 공예 체험을 한곳에서 예약하세요.
        </p>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 md:px-12 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 size={20} className="animate-spin text-stone-500" />
          </div>
        ) : tours.length === 0 ? (
          <div className="text-center py-24">
            <Compass size={28} strokeWidth={1.5} className="mx-auto mb-4 text-stone-600" />
            <p className="text-stone-400 text-sm">현재 운영 중인 투어가 없습니다.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {tours.map(tour => (
              <Link
                key={tour.id}
                href={`/tours/${tour.slug}`}
                className="group bg-stone-900/40 border border-white/[0.06] hover:border-white/20 transition-colors flex flex-col"
              >
                <div className="aspect-[4/3] bg-stone-900 overflow-hidden">
                  {tour.images?.[0] ? (
                    <img
                      src={tour.images[0]}
                      alt={tour.title}
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-stone-700">
                      <Compass size={48} strokeWidth={1} />
                    </div>
                  )}
                </div>
                <div className="p-5 flex-1 flex flex-col">
                  {tour.category && (
                    <p className="text-[10px] uppercase tracking-widest text-stone-400 mb-2">
                      {CATEGORY_LABELS[tour.category] ?? tour.category}
                    </p>
                  )}
                  <h2 className="text-lg font-medium tracking-tight mb-2 text-stone-50">{tour.title}</h2>
                  {tour.description && (
                    <p className="text-sm text-stone-300 font-light line-clamp-2 mb-4">{tour.description}</p>
                  )}
                  <div className="mt-auto space-y-1.5 text-xs text-stone-400">
                    {tour.durationMin && (
                      <div className="flex items-center gap-1.5">
                        <Clock size={11} /> {tour.durationMin}분
                      </div>
                    )}
                    {tour.maxGroupSize && (
                      <div className="flex items-center gap-1.5">
                        <Users size={11} /> 최대 {tour.maxGroupSize}명
                      </div>
                    )}
                    {tour.meetingPoint && (
                      <div className="flex items-center gap-1.5">
                        <MapPin size={11} /> {tour.meetingPoint}
                      </div>
                    )}
                  </div>
                  {tour.basePrice && (
                    <p className="text-base font-medium tracking-tight mt-4 pt-4 border-t border-white/[0.06] text-stone-100">
                      {tour.basePrice.toLocaleString()}원 <span className="text-xs text-stone-500 font-light">/ 인</span>
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-stone-800 py-12 px-6 md:px-12 mt-12">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="opacity-80">
            <Logo width={120} />
          </div>
          <div className="text-xs uppercase tracking-widest text-stone-500">
            © {new Date().getFullYear()} void anchae. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
