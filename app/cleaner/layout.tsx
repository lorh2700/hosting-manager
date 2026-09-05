'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Logo } from '@/components/Logo';
import {
  AlertTriangle,
  Package,
  History,
  ClipboardList,
  LogOut,
  Calendar as CalendarIcon,
  Hand,
  Settings,
  MoreHorizontal,
} from 'lucide-react';

// 하단 탭 4개 = 매일 쓰는 것. 나머지는 더보기.
const NAV_ITEMS = [
  { href: '/cleaner', label: '오늘', icon: ClipboardList },
  { href: '/cleaner/schedule', label: '신청', icon: Hand },
  { href: '/cleaner/issues', label: '이슈', icon: AlertTriangle },
  { href: '/cleaner/history', label: '기록', icon: History },
  { href: '/cleaner/calendar', label: '캘린더', icon: CalendarIcon },
  { href: '/cleaner/supplies', label: '비품', icon: Package },
  { href: '/cleaner/settings', label: '설정', icon: Settings },
];

const MOBILE_PRIMARY_COUNT = 4;

export default function CleanerLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && profile && profile.role !== 'cleaner' && profile.role !== 'admin') {
      router.replace('/admin');
    }
  }, [loading, profile, router]);

  useEffect(() => { setMoreOpen(false); }, [pathname]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout failed', err);
    } finally {
      window.location.href = '/login';
    }
  };

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
        window.location.reload();
      }
    } catch (err: unknown) {
      setError('로그인에 실패했습니다.');
      console.error('Login failed', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-stone-50">
        <div className="w-7 h-7 border-2 border-stone-200 border-t-[var(--brand)] rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-stone-50 p-5 font-sans">
        <Link
          href="/"
          aria-label="void anchae 홈으로"
          className="mb-9 inline-flex hover:opacity-80 transition-opacity"
        >
          <Logo width={200} variant="black" priority />
        </Link>
        <div className="bg-white p-8 sm:p-10 border border-stone-200 max-w-md w-full">
          <p className="text-[12px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">Cleaner</p>
          <h1 className="text-xl font-semibold text-stone-900 mb-1.5">청소 담당자 로그인</h1>
          <p className="text-stone-500 mb-7 text-sm">청소 일정을 확인하려면 로그인하세요.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-[12px] uppercase tracking-widest text-stone-600 mb-2">이메일</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full bg-white border border-stone-300 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                placeholder="example@email.com"
              />
            </div>
            <div>
              <label className="block text-[12px] uppercase tracking-widest text-stone-600 mb-2">비밀번호</label>
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

            {error && <p className="text-rose-600 text-xs">{error}</p>}

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
      </div>
    );
  }

  if (profile && profile.role !== 'cleaner' && profile.role !== 'admin') return null;

  const mainItems = NAV_ITEMS.slice(0, MOBILE_PRIMARY_COUNT);
  const moreItems = NAV_ITEMS.slice(MOBILE_PRIMARY_COUNT);
  const isMoreActive = moreItems.some(item =>
    pathname === item.href || (item.href !== '/cleaner' && pathname.startsWith(item.href)),
  );

  return (
    <div className="min-h-dvh bg-stone-50 font-sans text-stone-900 selection:bg-[var(--brand)]/20">
      <header className="bg-white border-b border-stone-200 px-5 py-4 flex items-center justify-between">
        <Link href="/cleaner" className="inline-flex items-center hover:opacity-80 transition-opacity" aria-label="void anchae 청소 홈">
          <Logo width={120} variant="black" priority />
        </Link>
        <div className="flex items-center gap-4">
          {profile?.displayName && (
            <span className="text-xs text-stone-500 hidden sm:inline">{profile.displayName}</span>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-[13px] uppercase tracking-widest text-stone-500 hover:text-stone-900 transition-colors"
            aria-label="로그아웃"
          >
            <LogOut size={13} />
            <span>로그아웃</span>
          </button>
        </div>
      </header>

      <main className="p-4 pb-28 md:p-8 md:pb-28 max-w-2xl mx-auto">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-stone-200 z-50 safe-bottom">
        <div className="max-w-2xl mx-auto flex items-stretch">
          {mainItems.map(item => {
            const isActive = pathname === item.href || (item.href !== '/cleaner' && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-3 min-h-[56px] transition-colors active:scale-95 ${
                  isActive ? 'text-stone-900' : 'text-stone-500'
                }`}
              >
                {isActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-[var(--brand)]" />}
                <Icon size={20} strokeWidth={isActive ? 2 : 1.7} className={isActive ? 'text-[var(--brand)]' : ''} />
                <span className="text-[12px] leading-none">{item.label}</span>
              </Link>
            );
          })}

          {moreItems.length > 0 && (
            <div className="relative flex-1">
              <button
                type="button"
                onClick={() => setMoreOpen(v => !v)}
                className={`relative flex-1 w-full flex flex-col items-center justify-center gap-1 py-3 min-h-[56px] transition-colors active:scale-95 ${
                  moreOpen || isMoreActive ? 'text-stone-900' : 'text-stone-500'
                }`}
              >
                {(moreOpen || isMoreActive) && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-[var(--brand)]" />}
                <MoreHorizontal size={20} strokeWidth={moreOpen || isMoreActive ? 2 : 1.7} className={moreOpen || isMoreActive ? 'text-[var(--brand)]' : ''} />
                <span className="text-[12px] leading-none">더보기</span>
              </button>

              {moreOpen && (
                <div className="absolute bottom-full right-2 mb-2 w-52 bg-white border border-stone-200 overflow-hidden shadow-2xl shadow-black/10">
                  {moreItems.map(item => {
                    const isActive = pathname === item.href || (item.href !== '/cleaner' && pathname.startsWith(item.href));
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`relative flex items-center gap-3 px-4 py-3 transition-colors active:bg-stone-100 ${
                          isActive
                            ? 'text-stone-900 bg-stone-50 font-medium before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:bg-[var(--brand)]'
                            : 'text-stone-700'
                        }`}
                      >
                        <Icon size={17} strokeWidth={1.7} className={isActive ? 'text-[var(--brand)]' : ''} />
                        <span className="text-[13px]">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </nav>
    </div>
  );
}
