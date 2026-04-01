'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ScrollUnfoldHero } from '@/components/ScrollUnfoldHero';
import { getPropertyImage } from '@/lib/propertyImages';
import type { Property } from '@/lib/types';

export default function PublicPortal() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProperties = async () => {
      try {
        const q = query(collection(db, 'properties'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name,
          timezone: doc.data().timezone,
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
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-white/20 font-sans">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center px-8 py-6 mix-blend-difference">
        <Link href="/" className="text-sm uppercase tracking-[0.2em] font-medium hover:opacity-70 transition-opacity">
          void anchae
        </Link>
        <div className="hidden md:flex items-center gap-8 text-[11px] uppercase tracking-widest font-medium text-white/70">
          <Link href="#" className="hover:text-white transition-colors">소개</Link>
          <Link href="#" className="hover:text-white transition-colors">공간</Link>
          <Link href="#" className="hover:text-white transition-colors">저널</Link>
          <Link href="#" className="hover:text-white transition-colors">문의</Link>
        </div>
        <Link href="/admin" className="text-[11px] uppercase tracking-widest font-medium border border-white/20 px-4 py-2 hover:bg-white hover:text-black transition-colors">
          호스트 로그인
        </Link>
      </nav>

      {/* Hero Section */}
      <ScrollUnfoldHero />

      {/* Philosophy Section */}
      <section className="py-32 px-6 md:px-12 max-w-[1200px] mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="text-3xl md:text-4xl font-light tracking-tight mb-8">
            VOID ANCHAE의<br />디자인 철학과 비전
          </h2>
          <p className="text-white/60 font-light tracking-wide max-w-3xl mx-auto leading-relaxed mb-12 text-sm md:text-base">
            void anchae는 공간을 독특하고 영감을 주는 안식처로 탈바꿈시키는 데 열정을 쏟고 있습니다. 전문 디자이너 팀이 창의성과 기능성을 결합하여 모든 프로젝트에 생명력을 불어넣습니다. 집, 사무실 또는 그 어떤 공간이든, 여러분의 비전을 현실로 만들어 드립니다. 다양한 디자인 서비스를 살펴보세요.
          </p>
          <div className="flex items-center justify-center gap-6">
            <Link href="#spaces" className="border border-white/30 px-8 py-4 text-[11px] uppercase tracking-widest font-semibold hover:bg-white hover:text-black transition-colors">
              공간 보기
            </Link>
            <Link href="#" className="text-[11px] uppercase tracking-widest font-semibold hover:text-white/70 transition-colors border-b border-transparent hover:border-white/70 pb-1">
              소개
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Spaces Grid Section */}
      <section id="spaces" className="py-24 px-6 md:px-12 max-w-[1600px] mx-auto border-t border-white/10">
        <div className="flex flex-col items-center mb-16">
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/50 mb-4">영감과 아이디어</p>
          <h2 className="text-4xl md:text-5xl font-light tracking-tight mb-16">VOID ANCHAE 공간</h2>

          {/* Filter Tabs */}
          <div className="flex flex-wrap justify-center gap-8 md:gap-12 text-[11px] uppercase tracking-widest font-medium text-white/50 border-b border-white/10 w-full pb-6">
            <button className="text-white border-b border-white pb-6 -mb-[25px]">모든 공간</button>
            <button className="hover:text-white transition-colors pb-6">서울</button>
            <button className="hover:text-white transition-colors pb-6">제주</button>
            <button className="hover:text-white transition-colors pb-6">부산</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-16">
          {properties.map((property, index) => (
            <motion.div
              key={property.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="group flex flex-col"
            >
              <Link href={`/book/${property.id}`} className="block relative aspect-[4/5] mb-6 overflow-hidden bg-[#111]">
                <Image
                  src={getPropertyImage(property.name)}
                  alt={property.name}
                  fill
                  className="object-cover transition-transform duration-[1.5s] ease-out group-hover:scale-105 opacity-80 group-hover:opacity-100"
                />

                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-center justify-center">
                  <div className="bg-white/10 backdrop-blur-md border border-white/20 text-white px-6 py-3 text-[11px] uppercase tracking-widest font-medium hover:bg-white hover:text-black transition-colors">
                    자세히 보기
                  </div>
                </div>
              </Link>

              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-light tracking-wide mb-1 group-hover:text-white/80 transition-colors">
                    {property.name}
                  </h3>
                  <p className="text-[11px] uppercase tracking-widest text-white/40">
                    {property.timezone.split('/')[1]?.replace('_', ' ') || 'Seoul'}
                  </p>
                </div>
                <div className="text-sm font-light text-white/40">
                  가격 문의
                </div>
              </div>
            </motion.div>
          ))}

          {properties.length === 0 && (
            <div className="col-span-full py-32 text-center text-white/40 font-light tracking-wide">
              현재 준비된 공간이 없습니다.
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-12 px-6 md:px-12 mt-20">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-xs uppercase tracking-[0.3em] font-semibold text-white/50">
            void anchae
          </div>
          <div className="text-[10px] uppercase tracking-widest text-white/30">
            © {new Date().getFullYear()} void anchae. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
