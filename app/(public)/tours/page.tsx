'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Clock, Users, MapPin, Compass, Loader2 } from 'lucide-react';
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

export default function PublicToursPage() {
  const [tours, setTours] = useState<PublicTour[]>([]);
  const [loading, setLoading] = useState(true);

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
