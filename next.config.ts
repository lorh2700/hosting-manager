import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [],
  },
  // 별하재 로마자 표기를 byulha 로 통일(2026-07)하기 전에 공유된 링크가 죽지 않도록.
  // 슬러그가 URL 에 들어가는 곳은 /book/[slug] 뿐이다.
  async redirects() {
    return [
      { source: '/book/byeolha', destination: '/book/byulha', permanent: true },
    ];
  },
  output: 'standalone',
  transpilePackages: ['motion'],
};

export default nextConfig;
