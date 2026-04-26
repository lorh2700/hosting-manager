'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home,
  HomeIcon,
  Calendar,
  BookOpen,
  MessageSquare,
  Users,
  UserCog,
  LogOut,
  Settings,
  MoreHorizontal,
  X,
  FileBarChart,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Logo } from '@/components/Logo';

const SIDEBAR_LINKS = [
  { href: '/admin', label: '대시보드', icon: Home, roles: ['super_admin', 'admin', 'host'] },
  { href: '/admin/properties', label: '숙소 관리', icon: HomeIcon, roles: ['super_admin', 'admin', 'host'] },
  { href: '/admin/calendar', label: '캘린더', icon: Calendar, roles: ['super_admin', 'admin', 'host'] },
  { href: '/admin/bookings', label: '예약', icon: BookOpen, roles: ['super_admin', 'admin', 'host'] },
  { href: '/admin/messages', label: '메시지', icon: MessageSquare, roles: ['super_admin', 'admin', 'host'] },
  { href: '/admin/cleaners', label: '청소 담당자', icon: Users, roles: ['super_admin', 'admin', 'host'] },
  { href: '/admin/cleaning-report', label: '청소 보고서', icon: FileBarChart, roles: ['super_admin', 'admin', 'host'] },
  { href: '/admin/users', label: '유저 관리', icon: UserCog, roles: ['super_admin', 'admin'] },
  { href: '/admin/settings/profile', label: '프로필', icon: Settings, roles: ['super_admin', 'admin', 'host', 'cleaner', 'viewer'] },
];

const MOBILE_PRIMARY_COUNT = 4;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, user } = useAuth();
  const role = profile?.role ?? 'host';
  const [unreadCount, setUnreadCount] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;

    const controller = new AbortController();
    const fetchUnread = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/messages/unread-count', { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          setUnreadCount(data.count ?? 0);
        }
      } catch { /* ignore */ }
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    const handleVisibility = () => { if (!document.hidden) fetchUnread(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user]);

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moreOpen]);

  useEffect(() => { setMoreOpen(false); }, [pathname]);

  const visibleLinks = SIDEBAR_LINKS.filter(link => link.roles.includes(role));
  const mobileMainLinks = visibleLinks.slice(0, MOBILE_PRIMARY_COUNT);
  const mobileMoreLinks = visibleLinks.slice(MOBILE_PRIMARY_COUNT);
  const isMoreActive = mobileMoreLinks.some(link => pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href)));

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 bg-white text-stone-900 min-h-screen flex-col border-r border-stone-200">
        <div className="px-7 pt-8 pb-7 flex flex-col gap-3">
          <Link href="/admin" aria-label="void anchae 관리자 홈" className="inline-flex">
            <Logo width={148} variant="black" priority />
          </Link>
          <Link href="/" className="text-[11px] uppercase tracking-[0.2em] text-stone-500 hover:text-stone-900 transition-colors">
            예약 포털 →
          </Link>
        </div>

        <nav className="flex-1 px-3 pb-6 space-y-px">
          {visibleLinks.map((link) => {
            const isActive = pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href));
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`group relative flex items-center gap-3 pl-4 pr-3 py-2.5 text-[13px] transition-colors ${
                  isActive
                    ? 'text-stone-900 font-medium bg-stone-50 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:bg-[var(--brand)]'
                    : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
                }`}
              >
                <Icon
                  size={16}
                  strokeWidth={isActive ? 2 : 1.6}
                  className={isActive ? 'text-[var(--brand)]' : 'text-stone-400 group-hover:text-stone-700'}
                />
                <span>{link.label}</span>
                {link.href === '/admin/messages' && unreadCount > 0 && (
                  <span className="ml-auto min-w-[20px] h-[18px] px-1.5 bg-[var(--brand)] flex items-center justify-center text-[10px] font-semibold text-white tabular-nums">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-5 py-5 border-t border-stone-200">
          <p className="text-[11px] text-stone-500 truncate mb-2">{user?.email}</p>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-stone-500 hover:text-stone-900 transition-colors text-[11px] uppercase tracking-widest"
          >
            <LogOut size={13} />
            로그아웃
          </button>
        </div>
      </aside>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-lg border-t border-stone-200 safe-bottom">
        <div className="flex items-stretch justify-around">
          {mobileMainLinks.map((link) => {
            const isActive = pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href));
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative flex flex-col items-center justify-center gap-1 py-3 flex-1 min-h-[56px] transition-colors active:scale-95 ${
                  isActive ? 'text-stone-900' : 'text-stone-500'
                }`}
              >
                {isActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-[var(--brand)]" />}
                <Icon size={21} strokeWidth={isActive ? 2 : 1.7} className={isActive ? 'text-[var(--brand)]' : ''} />
                <span className="text-[10.5px] leading-none">{link.label}</span>
                {link.href === '/admin/messages' && unreadCount > 0 && (
                  <span className="absolute top-1.5 left-1/2 ml-2 min-w-[18px] h-[18px] px-1 bg-[var(--brand)] flex items-center justify-center text-[9px] font-semibold text-white tabular-nums">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}

          {mobileMoreLinks.length > 0 && (
            <div ref={moreRef} className="relative flex-1">
              <button
                onClick={() => setMoreOpen(!moreOpen)}
                className={`relative flex flex-col items-center justify-center gap-1 w-full py-3 min-h-[56px] transition-colors active:scale-95 ${
                  moreOpen || isMoreActive ? 'text-stone-900' : 'text-stone-500'
                }`}
              >
                {(moreOpen || isMoreActive) && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-[var(--brand)]" />}
                {moreOpen ? <X size={21} strokeWidth={1.7} /> : <MoreHorizontal size={21} strokeWidth={1.7} />}
                <span className="text-[10.5px] leading-none">더보기</span>
              </button>

              {moreOpen && (
                <div className="absolute bottom-full right-2 mb-2 w-52 bg-white border border-stone-200 overflow-hidden shadow-2xl shadow-black/10">
                  {mobileMoreLinks.map((link) => {
                    const isActive = pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href));
                    const Icon = link.icon;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        className={`relative flex items-center gap-3 px-4 py-3 transition-colors active:bg-stone-100 ${
                          isActive ? 'text-stone-900 bg-stone-50 font-medium before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:bg-[var(--brand)]' : 'text-stone-700'
                        }`}
                      >
                        <Icon size={17} strokeWidth={1.7} className={isActive ? 'text-[var(--brand)]' : ''} />
                        <span className="text-[13px]">{link.label}</span>
                      </Link>
                    );
                  })}
                  <div className="border-t border-stone-200">
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-3 px-4 py-3 w-full text-stone-600 transition-colors active:bg-stone-100"
                    >
                      <LogOut size={17} strokeWidth={1.7} />
                      <span className="text-[13px]">로그아웃</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </nav>
    </>
  );
}
