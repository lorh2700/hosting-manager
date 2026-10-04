import type { Metadata } from 'next';
import { guestLanguage } from '@/lib/guest-languages';
import GuestStayApp from '../GuestStayApp';

export const metadata: Metadata = { title: '게스트 라운지 미리보기', robots: { index: false, follow: false }, referrer: 'no-referrer', manifest: '/stay/preview/manifest.webmanifest' };

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  return <GuestStayApp slug="hwayeonjae" initialLanguage={guestLanguage(lang || 'ko')} preview />;
}
