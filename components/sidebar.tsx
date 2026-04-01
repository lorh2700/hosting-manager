'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, HomeIcon, Calendar, BookOpen, MessageSquare, Users } from 'lucide-react';

const SIDEBAR_LINKS = [
  { href: '/admin', label: '대시보드', icon: Home },
  { href: '/admin/properties', label: '숙소 관리', icon: HomeIcon },
  { href: '/admin/calendar', label: '통합 캘린더', icon: Calendar },
  { href: '/admin/bookings', label: '예약 관리', icon: BookOpen },
  { href: '/admin/messages', label: '메시지', icon: MessageSquare },
  { href: '/admin/cleaners', label: '청소 담당자', icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="w-64 bg-[#050505] text-white/70 min-h-screen flex flex-col border-r border-white/10">
      <div className="p-8 border-b border-white/10 flex flex-col gap-4">
        <span className="text-sm tracking-[0.2em] font-medium text-white">void anchae 관리자</span>
        <Link href="/" className="text-[10px] tracking-widest text-white/40 hover:text-white transition-colors">
          ← 예약 포털로 돌아가기
        </Link>
      </div>
      <nav className="flex-1 py-8 px-6 space-y-4">
        {SIDEBAR_LINKS.map((link) => {
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
    </div>
  );
}
