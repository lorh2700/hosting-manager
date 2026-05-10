'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { useAuth } from '@/components/AuthProvider';
import { Logo } from '@/components/Logo';
import { writeAdminMode, type AdminMode } from '@/lib/adminMode';
import { Home, Compass } from 'lucide-react';

const PUBLIC_PATHS = ['/admin/calendar'];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginMode, setLoginMode] = useState<AdminMode | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const pathname = usePathname();

  const isPublicPath = PUBLIC_PATHS.includes(pathname);

  // Pre-select login mode from ?mode=tour|host query param. Reading
  // window.location.search directly inside an effect keeps this purely
  // client-side, so child pages don't need to be wrapped in <Suspense>
  // (which would fail static prerender otherwise).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const param = new URLSearchParams(window.location.search).get('mode');
    if (param === 'tour' || param === 'host') setLoginMode(param);
  }, []);

  useEffect(() => {
    if (!loading && profile?.role === 'cleaner') {
      router.replace('/cleaner');
    }
  }, [loading, profile, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '로그인에 실패했습니다.');
      } else {
        // Persist the chosen admin area before refreshing — sidebar/dashboard
        // pick this up on the next render.
        if (loginMode) writeAdminMode(loginMode);
        window.location.reload();
      }
    } catch (err) {
      setError('로그인에 실패했습니다.');
      console.error('Login failed', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (loading && !isPublicPath) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-7 h-7 border-2 border-stone-200 border-t-[var(--brand)] rounded-full animate-spin" />
      </div>
    );
  }

  // Public paths: skip login, render without sidebar
  if (isPublicPath && !profile) {
    return (
      <div className="min-h-screen bg-white font-sans text-stone-900 selection:bg-[var(--brand)]/20">
        <main className="p-4 pb-24 md:p-8 lg:p-12 md:pb-12 overflow-y-auto">
          {children}
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 p-5 font-sans">
        <Link
          href="/"
          aria-label="void anchae 홈으로"
          className="mb-9 inline-flex hover:opacity-80 transition-opacity"
        >
          <Logo width={200} variant="black" priority />
        </Link>
        {loginMode === null ? (
          // Step 1: choose area
          <div className="bg-white p-8 sm:p-10 border border-stone-200 max-w-md w-full">
            <p className="text-[10px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">Admin</p>
            <h1 className="text-xl font-semibold text-stone-900 mb-1.5">관리자 로그인</h1>
            <p className="text-stone-500 mb-7 text-sm">먼저 관리하실 영역을 선택해주세요.</p>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setLoginMode('host')}
                className="w-full flex items-center gap-4 p-5 border border-stone-200 hover:border-[var(--brand)] hover:bg-[var(--brand-tint)] transition-colors group text-left"
              >
                <div className="w-12 h-12 bg-[var(--brand-tint)] group-hover:bg-white border border-[var(--brand)]/20 flex items-center justify-center shrink-0 transition-colors">
                  <Home size={22} strokeWidth={1.8} className="text-[var(--brand)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-900 mb-0.5">숙박 호스트</p>
                  <p className="text-xs text-stone-500 leading-relaxed">한옥 객실 · 예약 · 청소 관리</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setLoginMode('tour')}
                className="w-full flex items-center gap-4 p-5 border border-stone-200 hover:border-[var(--brand)] hover:bg-[var(--brand-tint)] transition-colors group text-left"
              >
                <div className="w-12 h-12 bg-[var(--brand-tint)] group-hover:bg-white border border-[var(--brand)]/20 flex items-center justify-center shrink-0 transition-colors">
                  <Compass size={22} strokeWidth={1.8} className="text-[var(--brand)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-900 mb-0.5">투어 운영자</p>
                  <p className="text-xs text-stone-500 leading-relaxed">투어 상품 · 일정 · 예약 관리</p>
                </div>
              </button>
            </div>
          </div>
        ) : (
          // Step 2: credentials
          <div className="bg-white p-8 sm:p-10 border border-stone-200 max-w-md w-full">
            <button
              type="button"
              onClick={() => { setLoginMode(null); setError(''); }}
              className="text-[11px] uppercase tracking-widest text-stone-500 hover:text-stone-900 mb-4 inline-flex items-center gap-1 transition-colors"
            >
              ← 영역 다시 선택
            </button>

            <p className="text-[10px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">
              {loginMode === 'tour' ? '투어 운영자' : '숙박 호스트'}
            </p>
            <h1 className="text-xl font-semibold text-stone-900 mb-1.5">관리자 로그인</h1>
            <p className="text-stone-500 mb-6 text-sm">
              {loginMode === 'tour'
                ? '투어 상품과 예약을 관리합니다.'
                : '숙소와 청소 일정을 관리합니다.'}
            </p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-stone-600 mb-2">이메일</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  autoComplete="email"
                  className="w-full bg-white border border-stone-300 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                  placeholder="example@email.com"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-stone-600 mb-2">비밀번호</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full bg-white border border-stone-300 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <p className="text-rose-600 text-xs">{error}</p>
              )}

              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white py-3.5 text-sm font-semibold uppercase tracking-widest transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
              >
                {isLoggingIn ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    로그인 중...
                  </>
                ) : (
                  '로그인'
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  if (profile?.role === 'cleaner') return null;

  if (profile?.status === 'suspended') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 p-5 font-sans">
        <div className="bg-white p-8 border-l-2 border border-stone-200 border-l-rose-500 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold text-stone-900 mb-2">계정 비활성화</h1>
          <p className="text-stone-600 text-sm">계정이 비활성화되었습니다. 관리자에게 문의하세요.</p>
        </div>
      </div>
    );
  }

  if (profile?.status === 'pending_invite') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 p-5 font-sans">
        <div className="bg-white p-8 border-l-2 border border-stone-200 border-l-amber-500 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold text-stone-900 mb-2">승인 대기중</h1>
          <p className="text-stone-600 text-sm">관리자의 승인을 기다리고 있습니다. 잠시만 기다려주세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-stone-50 font-sans text-stone-900 selection:bg-[var(--brand)]/20">
      <Sidebar />
      <main className="flex-1 px-4 pt-4 pb-28 md:px-8 md:pt-8 md:pb-12 lg:px-10 lg:pt-10 overflow-y-auto min-w-0">
        {children}
      </main>
    </div>
  );
}
