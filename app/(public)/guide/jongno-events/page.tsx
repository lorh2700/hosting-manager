import { Suspense } from 'react';
import type { Metadata } from 'next';
import JongnoEvents from './JongnoEvents';

export const metadata: Metadata = {
  title: '종로 문화 일정 | Jongno Cultural Calendar',
  description: '북촌, 인사동, 서촌, 대학로의 확인된 전시·공연·축제와 체험 일정을 날짜별로 살펴보세요.',
};
export default function JongnoEventsPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#f4f0e8] px-6 pt-36 text-stone-700"><p role="status">문화 달력을 불러오는 중… / Loading the cultural calendar…</p></main>}><JongnoEvents /></Suspense>;
}
