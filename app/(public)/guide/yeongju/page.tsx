import type { Metadata } from 'next';
import YeongjuGuide from './YeongjuGuide';
export const metadata: Metadata = { title: '영주 가이드', description: '영주의 여행지와 맛집, 카페를 만나보세요.' };
export default function Page() { return <YeongjuGuide />; }
