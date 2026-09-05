import type { MetadataRoute } from 'next';

/**
 * PWA 매니페스트 — 갤럭시 탭·폰 홈 화면에 앱처럼 설치된다 (주소창 없는 독립 실행).
 * 시작 주소는 /admin: 로그인 전이면 로그인 화면, 청소담당자 계정이면 /cleaner 로 넘어간다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'void anchae 호스트',
    short_name: 'void anchae',
    description: '한옥 스테이 운영: 예약, 청소, 메시지',
    lang: 'ko',
    start_url: '/admin',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FAF6F1',
    theme_color: '#A66B3D',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
