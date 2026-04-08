'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'motion/react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ScrollUnfoldHero } from '@/components/ScrollUnfoldHero';
import type { Property } from '@/lib/types';

export default function PublicPortal() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [regionFilter, setRegionFilter] = useState<string | null>(null);

  useEffect(() => {
    const fetchProperties = async () => {
      try {
        const q = query(collection(db, 'properties'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name,
          timezone: doc.data().timezone,
          imageUrl: doc.data().imageUrl ?? null,
          images: doc.data().images ?? [],
          region: doc.data().region ?? null,
          description: doc.data().description ?? null,
        }));
        setProperties(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchProperties();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0C0A09]">
        <div className="w-8 h-8 border-t-2 border-stone-300 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0C0A09] text-stone-50 selection:bg-stone-400/20 font-sans">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center px-8 py-6 mix-blend-difference">
        <Link href="/" className="text-sm uppercase tracking-[0.2em] font-medium hover:opacity-70 transition-opacity">
          void anchae
        </Link>
        <div className="hidden md:flex items-center gap-8 text-xs uppercase tracking-widest font-medium text-stone-400">
          <Link href="#spaces" className="hover:text-stone-50 transition-colors">공간</Link>
          <Link href="#about" className="hover:text-stone-50 transition-colors">소개</Link>
        </div>
        <Link href="/admin" className="text-xs uppercase tracking-widest font-medium border border-stone-700 px-4 py-2 rounded-full hover:bg-stone-50 hover:text-stone-900 transition-colors">
          호스트
        </Link>
      </nav>

      {/* Hero Section */}
      <ScrollUnfoldHero />

      {/* Philosophy Section */}
      <section id="about" className="py-32 px-6 md:px-12 max-w-[1200px] mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="text-3xl md:text-4xl font-light tracking-tight mb-8">
            VOID ANCHAE의<br />디자인 철학과 비전
          </h2>
          <p className="text-stone-400 font-light tracking-wide max-w-3xl mx-auto leading-relaxed mb-12 text-sm md:text-base">
            void anchae는 공간을 독특하고 영감을 주는 안식처로 탈바꿈시키는 데 열정을 쏟고 있습니다. 전문 디자이너 팀이 창의성과 기능성을 결합하여 모든 프로젝트에 생명력을 불어넣습니다. 집, 사무실 또는 그 어떤 공간이든, 여러분의 비전을 현실로 만들어 드립니다.
          </p>
          <Link href="#spaces" className="inline-block border border-stone-600 px-8 py-4 rounded-full text-xs uppercase tracking-widest font-semibold hover:bg-stone-50 hover:text-stone-900 transition-colors">
            공간 보기
          </Link>
        </motion.div>
      </section>

      {/* Spaces Grid Section */}
      <section id="spaces" className="py-24 px-6 md:px-12 max-w-[1600px] mx-auto border-t border-stone-800">
        <div className="flex flex-col items-center mb-16">
          <p className="text-xs uppercase tracking-[0.3em] text-stone-500 mb-4">영감과 아이디어</p>
          <h2 className="text-4xl md:text-5xl font-light tracking-tight mb-16">VOID ANCHAE 공간</h2>

          {/* Filter Tabs */}
          <div className="flex flex-wrap justify-center gap-8 md:gap-12 text-xs uppercase tracking-widest font-medium text-stone-500 border-b border-stone-800 w-full pb-6">
            {[
              { label: '모든 공간', value: null },
              { label: '서울', value: '서울' },
              { label: '영주', value: '영주' },
            ].map(tab => (
              <button
                key={tab.label}
                onClick={() => setRegionFilter(tab.value)}
                className={`pb-6 transition-colors ${regionFilter === tab.value ? 'text-stone-50 border-b border-stone-300 -mb-[25px]' : 'hover:text-stone-200'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-16">
          {properties.filter(p => !regionFilter || p.region === regionFilter).map((property, index) => (
            <motion.div
              key={property.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="group flex flex-col"
            >
              <Link href={`/book/${property.id}`} className="block relative aspect-[4/5] mb-6 overflow-hidden bg-stone-900 rounded-lg">
                <Image
                  src={property.images?.[0] ?? property.imageUrl ?? '/images/main_yard.webp'}
                  alt={property.name}
                  fill
                  className="object-cover transition-transform duration-[1.5s] ease-out group-hover:scale-105 opacity-80 group-hover:opacity-100"
                />

                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-center justify-center">
                  <div className="bg-stone-900/60 backdrop-blur-md border border-stone-600/30 text-stone-100 px-6 py-3 rounded-full text-xs uppercase tracking-widest font-medium hover:bg-stone-50 hover:text-stone-900 transition-colors">
                    자세히 보기
                  </div>
                </div>
              </Link>

              <div>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-lg font-light tracking-wide group-hover:text-stone-300 transition-colors">
                    {property.name}
                  </h3>
                  <p className="text-xs uppercase tracking-widest text-stone-500">
                    {property.region || 'Seoul'}
                  </p>
                </div>
                {property.description && (
                  <p className="text-sm text-stone-500 font-light leading-relaxed">
                    {property.description}
                  </p>
                )}
              </div>
            </motion.div>
          ))}

          {properties.length === 0 && (
            <div className="col-span-full py-32 text-center text-stone-600 font-light tracking-wide">
              현재 준비된 공간이 없습니다.
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-800 py-12 px-6 md:px-12 mt-20">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-xs uppercase tracking-[0.3em] font-semibold text-stone-500">
            void anchae
          </div>
          <div className="text-xs uppercase tracking-widest text-stone-600">
            © {new Date().getFullYear()} void anchae. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
