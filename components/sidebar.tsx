'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, HomeIcon, Calendar, BookOpen, MessageSquare, Users, UserCog, LogOut, Settings, Link2 } from 'lucide-react';
import { useAuth } from '@/components/FirebaseProvider';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const SIDEBAR_LINKS = [
  { href: '/admin', label: '대시보드', icon: Home, roles: ['super_admin', 'admin', 'host'] },
  { href: '/admin/properties', label: '숙소 관리', icon: HomeIcon, roles: ['super_admin', 'admin', 'host'] },
  { href: '/admin/calendar', label: '통합 캘린더', icon: Calendar, roles: ['super_admin', 'admin', 'host'] },
  { href: '/admin/bookings', label: '예약 관리', icon: BookOpen, roles: ['super_admin', 'admin', 'host'] },
  { href: '/admin/messages', label: '메시지', icon: MessageSquare, roles: ['super_admin', 'admin', 'host'] },

  { href: '/admin/cleaners', label: '청소 담당자', icon: Users, roles: ['super_admin', 'admin', 'host'] },
  { href: '/admin/users', label: '유저 관리', icon: UserCog, roles: ['super_admin', 'admin'] },
  { href: '/admin/integrations', label: '연동 관리', icon: Link2, roles: ['super_admin', 'admin'] },
  { href: '/admin/settings/profile', label: '프로필', icon: Settings, roles: ['super_admin', 'admin', 'host', 'cleaner', 'viewer'] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { profile, user } = useAuth();
  const role = profile?.role ?? 'host';

  const visibleLinks = SIDEBAR_LINKS.filter(link => link.roles.includes(role));

  const handleLogout = () => signOut(auth);

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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0a] border-t border-white/10 flex items-center justify-around px-1">
        {visibleLinks.map((link) => {
          const isActive = pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href));
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex flex-col items-center gap-1 py-3 px-1 flex-1 transition-colors ${
                isActive ? 'text-white' : 'text-white/35'
              }`}
            >
              <Icon size={20} strokeWidth={isActive ? 2 : 1.5} />
              <span className="text-[9px] tracking-wide font-medium leading-none">{link.label}</span>
            </Link>
          );
        })}
        <button
          onClick={handleLogout}
          className="flex flex-col items-center gap-1 py-3 px-1 flex-1 text-white/35 hover:text-white transition-colors"
        >
          <LogOut size={20} strokeWidth={1.5} />
          <span className="text-[9px] tracking-wide font-medium leading-none">로그아웃</span>
        </button>
      </nav>
    </>
  );
}
