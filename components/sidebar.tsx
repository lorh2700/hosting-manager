'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, HomeIcon, Calendar, BookOpen, MessageSquare, Users, UserCog, LogOut, Settings, MoreHorizontal, X, FileBarChart } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

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

// First 4 items always shown in mobile bottom nav; rest go into "more" menu
const MOBILE_PRIMARY_COUNT = 4;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, user } = useAuth();
  const role = profile?.role ?? 'host';
  const [unreadCount, setUnreadCount] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Poll unread message count — pause when tab is hidden
  useEffect(() => {
    if (!user) return;

    const fetchUnread = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/messages/unread-count');
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
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', handleVisibility); };
  }, [user]);

  // Close "more" menu on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moreOpen]);

  // Close "more" menu on route change
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
      <div className="hidden md:flex w-64 bg-[#050505] text-white/70 min-h-screen flex-col border-r border-white/10">
        <div className="p-8 border-b border-white/10 flex flex-col gap-4">
          <span className="text-sm tracking-[0.2em] font-medium text-white">void anchae 관리자</span>
          <Link href="/" className="text-[10px] tracking-widest text-white/40 hover:text-white transition-colors">
            ← 예약 포털로 돌아가기
          </Link>
        </div>
        <nav className="flex-1 py-8 px-6 space-y-4">
          {visibleLinks.map((link) => {
            const isActive = pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href));
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-4 px-4 py-3 transition-colors text-[11px] uppercase tracking-widest font-medium ${
                  isActive ? 'text-white border border-white/20 bg-white/5' : 'hover:text-white text-white/50'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-white' : 'text-white/50'} />
                <span>{link.label}</span>
                {link.href === '/admin/messages' && unreadCount > 0 && (
                  <span className="ml-auto w-5 h-5 bg-indigo-500 rounded-full flex items-center justify-center text-[9px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="p-6 border-t border-white/10">
          <p className="text-[10px] text-white/30 truncate mb-3">{user?.email}</p>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 text-white/40 hover:text-white transition-colors text-[11px] uppercase tracking-widest"
          >
            <LogOut size={14} />
            로그아웃
          </button>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0a]/95 backdrop-blur-lg border-t border-white/10 safe-bottom">
        <div className="flex items-stretch justify-around">
          {mobileMainLinks.map((link) => {
            const isActive = pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href));
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative flex flex-col items-center justify-center gap-1 py-3.5 flex-1 min-h-[56px] transition-colors active:scale-95 ${
                  isActive ? 'text-white' : 'text-white/40'
                }`}
              >
                <Icon size={22} strokeWidth={isActive ? 2 : 1.5} />
                <span className="text-[10px] tracking-wide font-medium leading-none">{link.label}</span>
                {link.href === '/admin/messages' && unreadCount > 0 && (
                  <span className="absolute top-1.5 left-1/2 ml-2 w-[18px] h-[18px] bg-indigo-500 rounded-full flex items-center justify-center text-[9px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}

          {/* More menu button */}
          {mobileMoreLinks.length > 0 && (
            <div ref={moreRef} className="relative flex-1">
              <button
                onClick={() => setMoreOpen(!moreOpen)}
                className={`flex flex-col items-center justify-center gap-1 w-full py-3.5 min-h-[56px] transition-colors active:scale-95 ${
                  moreOpen || isMoreActive ? 'text-white' : 'text-white/40'
                }`}
              >
                {moreOpen ? <X size={22} strokeWidth={1.5} /> : <MoreHorizontal size={22} strokeWidth={1.5} />}
                <span className="text-[10px] tracking-wide font-medium leading-none">더보기</span>
              </button>

              {/* Popover menu */}
              {moreOpen && (
                <div className="absolute bottom-full right-0 mb-2 mr-1 w-52 bg-[#111] border border-white/10 rounded-2xl overflow-hidden shadow-2xl shadow-black/60">
                  {mobileMoreLinks.map((link) => {
                    const isActive = pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href));
                    const Icon = link.icon;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        className={`flex items-center gap-3.5 px-5 py-3.5 transition-colors active:bg-white/10 ${
                          isActive ? 'text-white bg-white/5' : 'text-white/60'
                        }`}
                      >
                        <Icon size={18} strokeWidth={1.5} />
                        <span className="text-[13px]">{link.label}</span>
                      </Link>
                    );
                  })}
                  <div className="border-t border-white/10">
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-3.5 px-5 py-3.5 w-full text-white/40 transition-colors active:bg-white/10"
                    >
                      <LogOut size={18} strokeWidth={1.5} />
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
