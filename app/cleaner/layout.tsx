'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Sidebar } from '@/components/sidebar';
import ManagerInstall from '@/components/ManagerInstall';
import { Logo } from '@/components/Logo';
import AuthSessionNotice from '@/components/AuthSessionNotice';
import { mayUseOperationalPath } from '@/lib/operational-permissions';
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

// 매일 쓰는 하단 탭 5개. 재고·세탁·비품은 기록 탭에서 바로 입력한다.
const NAV_ITEMS = [
  { href: '/cleaner', label: '오늘', icon: ClipboardList },
  { href: '/cleaner/schedule', label: '청소 신청', icon: Hand },
  { href: '/cleaner/calendar', label: '일정', icon: CalendarIcon },
  { href: '/cleaner/records', label: '기록', icon: Package },
  { href: '/cleaner/issues', label: '신고', icon: AlertTriangle },
  { href: '/cleaner/supplies', label: '비품 요청 내역', icon: Package },
  { href: '/cleaner/history', label: '청소 기록', icon: History },
  { href: '/cleaner/settings', label: '설정', icon: Settings },
];

const MOBILE_PRIMARY_COUNT = 5;

export default function CleanerLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, error, refreshProfile } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !error && profile && !['cleaner','admin','manager','super_admin'].includes(profile.role)) {
      router.replace('/admin');
    }
  }, [loading, error, profile, router]);

  useEffect(() => { setMoreOpen(false); }, [pathname]);
  useEffect(() => { if (!loading && !error && !user) router.replace('/login?next=' + encodeURIComponent(pathname + window.location.search)); }, [loading, error, user, pathname, router]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout failed', err);
    } finally {
      window.location.href = '/login';
    }
  };

  if (error && !loading) return <AuthSessionNotice error={error} onRetry={refreshProfile} />;

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-stone-50">
        <div className="w-7 h-7 border-2 border-stone-200 border-t-[var(--brand)] rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <div role="status" className="min-h-dvh grid place-items-center">로그인 화면으로 이동 중…</div>;

  if (profile && !['cleaner','admin','manager','super_admin'].includes(profile.role)) return null;

  const showAdminNavigation = profile?.role === 'super_admin' || profile?.role === 'admin' || profile?.role === 'manager';
  const allowedItems = NAV_ITEMS.filter(item => !!profile && mayUseOperationalPath(profile, item.href));
  const mainItems = allowedItems.slice(0, MOBILE_PRIMARY_COUNT);
  const moreItems = allowedItems.slice(MOBILE_PRIMARY_COUNT);
  const isMoreActive = moreItems.some(item =>
    pathname === item.href || (item.href !== '/cleaner' && pathname.startsWith(item.href)),
  );

  return (
    <div className="flex min-h-dvh bg-stone-50 font-sans text-stone-900 selection:bg-[var(--brand)]/20">
      {showAdminNavigation && <div className="hidden md:block shrink-0"><Sidebar /></div>}
      <div className="flex-1 min-w-0">
      {showAdminNavigation && <div className="flex items-center justify-between gap-3 border-b bg-white px-4 py-2"><span className="text-xs text-stone-500">내 청소 업무 · 관리 권한 유지</span><Link href="/admin" className="inline-flex min-h-11 items-center rounded-xl border border-stone-300 px-4 text-sm font-medium">관리자 화면으로</Link></div>}
      <header className="bg-white border-b border-stone-200 px-5 py-4 flex items-center justify-between">
        <Link href="/cleaner" className="inline-flex items-center hover:opacity-80 transition-opacity" aria-label="void anchae 청소 홈">
          <Logo width={120} variant="black" priority />
        </Link>
        <div className="flex items-center gap-4">
          {moreItems.length > 0 && (
            <div className="relative z-[55]">
              <button
                type="button"
                onClick={() => setMoreOpen(v => !v)}
                className={`relative  flex flex-col items-center justify-center gap-1 py-3 min-h-[56px] transition-colors active:scale-95 ${
                  moreOpen || isMoreActive ? 'text-stone-900' : 'text-stone-500'
                }`}
              >
                {(moreOpen || isMoreActive) && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-[var(--brand)]" />}
                <MoreHorizontal size={20} strokeWidth={moreOpen || isMoreActive ? 2 : 1.7} className={moreOpen || isMoreActive ? 'text-[var(--brand)]' : ''} />
                <span className="text-[12px] leading-none">더보기</span>
              </button>

              {moreOpen && (
                <div className="absolute top-full right-2 mt-2 w-52 bg-white border border-stone-200 max-h-[65dvh] overflow-y-auto shadow-2xl shadow-black/10">
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
        <ManagerInstall />
        {profile && mayUseOperationalPath(profile, pathname) ? children : <section className="border bg-white p-5"><h1 className="font-semibold">사용 권한이 없는 메뉴입니다.</h1><p className="mt-3 text-sm text-stone-500">담당 숙소와 메뉴 권한을 관리자에게 확인해 주세요.</p><Link href={allowedItems[0]?.href || '/cleaner/settings'} className="mt-5 inline-block underline">사용 가능한 메뉴로 이동</Link></section>}
      </main>

      {/* Mobile bottom nav */}
      <nav className={`fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-stone-200 z-50 safe-bottom ${showAdminNavigation ? 'md:left-60' : ''}`}>
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


        </div>
      </nav>
      </div>
    </div>
  );
}
