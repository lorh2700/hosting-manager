import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPropertyDisplay } from '@/lib/property-display';
import { guestLanguage } from '@/lib/guest-languages';
import GuestStayApp from '../GuestStayApp';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: 'Your stay · 게스트 라운지', description: '숙소 안내와 투어, 택시, 숙소 문의를 휴대폰에서 이용하세요.',
    robots: { index: false, follow: false }, referrer: 'no-referrer', manifest: '/stay/' + encodeURIComponent(slug) + '/manifest.webmanifest' };
}

export default async function GuestStayPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { slug } = await params;
  const property = getPropertyDisplay(slug);
  if (!property || property.status !== 'active') notFound();
  const query = await searchParams;
  return <GuestStayApp slug={property.slug} initialLanguage={guestLanguage(query.lang)} />;
}
