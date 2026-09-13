import type { Metadata, Viewport } from 'next';
import { Inter, Cormorant_Garamond } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { AppProviders } from '@/components/AppProviders';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const cormorantGaramond = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-serif',
});

const SITE_URL = 'https://voidanchae.com';
const SITE_TITLE = 'void anchae · 큐레이션된 한옥 스테이';
const SITE_DESCRIPTION = '그저 머물러도 충분합니다. 서울 북촌과 경북 영주, 당신의 시간과 마음이 스며드는 한옥 스테이 VOID ANCHAE.';
const OG_IMAGE = `${SITE_URL}/images/main_yard.jpg`;

// 모바일: 안전 영역까지 그리고(viewport-fit) 상태바 색을 브랜드 색으로.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#A66B3D',
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: '%s · void anchae',
  },
  description: SITE_DESCRIPTION,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'void anchae' },
  icons: { apple: '/icons/apple-touch-icon.png' },
  alternates: {
    canonical: '/',
    languages: {
      'ko-KR': '/',
    },
  },
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: SITE_URL,
    siteName: 'void anchae',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: 'void anchae 한옥 스테이' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

const LODGING_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'LodgingBusiness',
  name: 'void anchae',
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  image: OG_IMAGE,
  address: {
    '@type': 'PostalAddress',
    addressLocality: '서울 종로구 북촌',
    addressCountry: 'KR',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${inter.variable} ${cormorantGaramond.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(LODGING_JSON_LD) }}
        />
      </head>
      <body suppressHydrationWarning>
        <AuthProvider>
          <AppProviders>{children}</AppProviders>
        </AuthProvider>
      </body>
    </html>
  );
}
