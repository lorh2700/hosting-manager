'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PROPERTY_TABS = [
  { path: '', label: '캘린더' },
  { path: '/channels', label: '채널 연결' },
  { path: '/settings', label: '숙소 설정' },
  { path: '/camera', label: '복도 카메라' },
  { path: '/checkout-qr', label: '체크아웃 QR' },
] as const;

export function PropertyNavigation({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const basePath = `/admin/properties/${encodeURIComponent(propertyId)}`;

  return (
    <nav aria-label="숙소 관리 메뉴" className="flex gap-1 overflow-x-auto border border-stone-200 bg-stone-50 p-1">
      {PROPERTY_TABS.map(tab => {
        const href = `${basePath}${tab.path}`;
        const active = pathname === href || (tab.path !== '' && pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-11 shrink-0 flex-1 items-center justify-center whitespace-nowrap px-4 py-2 text-center text-[13px] font-medium tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-stone-900 ${active ? 'bg-[var(--brand)] text-white' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900'}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
