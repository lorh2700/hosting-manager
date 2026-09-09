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
  { href: '/cleaner/calendar', label: '일정', icon: CalendarIcon },
  { href: '/cleaner/schedule', label: '신청', icon: Hand },
  { href: '/cleaner/issues', label: '이슈', icon: AlertTriangle },
  { href: '/cleaner/history', label: '기록', icon: History },
  { href: '/cleaner/supplies', label: '비품', icon: Package },
  { href: '/cleaner/settings', label: '설정', icon: Settings },
];

const MOBILE_PRIMARY_COUNT = 3;

export default function CleanerLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && profile && profile.role !== 'cleaner' && profile.role !== 'admin') {
      router.replace('/admin');
    }
  }, [loading, profile, router]);

  useEffect(() => { setMoreOpen(false); }, [pathname]);
  useEffect(() => { if (!loading && !user) router.replace('/login?next=' + encodeURIComponent(pathname + window.location.search)); }, [loading, user, pathname, router]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout failed', err);
    } finally {
      window.location.href = '/login';
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-stone-50">
        <div className="w-7 h-7 border-2 border-stone-200 border-t-[var(--brand)] rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <div role="status" className="min-h-dvh grid place-items-center">로그인 화면으로 이동 중…</div>;

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
                <div className="absolute bottom-full right-2 mb-2 w-52 bg-white border border-stone-200 max-h-[65dvh] overflow-y-auto shadow-2xl shadow-black/10">
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
