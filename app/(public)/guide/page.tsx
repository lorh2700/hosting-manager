import type { Metadata } from 'next';
import BukchonGuide from './BukchonGuide';

export const metadata: Metadata = { title: '북촌 가이드 | void anchae', description: '북촌과 주변의 맛집, 투어, 여행지를 한곳에서 만나보세요.' };
export default function GuidePage() { return <BukchonGuide />; }
