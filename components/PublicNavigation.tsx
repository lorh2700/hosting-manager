'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Logo } from '@/components/Logo';

const NAV_LINKS = [
  { href: '/brand', label: '브랜드' },
  { href: '/#spaces', label: '공간' },
  { href: '/tours', label: '투어' },
  { href: '/about', label: '호스팅 지원 플랫폼' },
];

export function PublicNavigation() {
  const pathname = usePathname();
  return <Navigation key={pathname} pathname={pathname} />;
}

function Navigation({ pathname }: { pathname: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const closeMenu = () => setMobileOpen(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) setMobileOpen(false);
    };
    const desktop = window.matchMedia('(min-width: 1024px)');
    const onBreakpoint = () => { if (desktop.matches) setMobileOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    desktop.addEventListener('change', onBreakpoint);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      desktop.removeEventListener('change', onBreakpoint);
    };
  }, [mobileOpen]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav ref={navRef} aria-label="주 메뉴" className="fixed top-0 left-0 right-0 z-50 bg-stone-950/95 lg:bg-stone-950/55 backdrop-blur-md border-b border-white/[0.06]">
      <div className="flex justify-between items-center gap-3 px-4 sm:px-6 md:px-8 h-16 md:h-[72px]">
        <Link href="/" aria-label="void anchae 홈" onClick={closeMenu} className="flex items-center shrink-0 max-[360px]:w-[120px] hover:opacity-80 transition-opacity">
          <Logo width={140} className="max-w-full" priority />
        </Link>
        <div className="hidden lg:flex items-center gap-5 text-sm">
          {NAV_LINKS.map(link => (
            <Link key={link.href} href={link.href} aria-current={isActive(link.href) ? 'page' : undefined} className={`py-3 transition-colors ${isActive(link.href) ? 'text-white' : 'text-stone-300 hover:text-white'}`}>
              {link.label}
            </Link>
          ))}
        </div>
        <div className="hidden lg:flex items-center gap-3 text-xs">
          <Link href="/#find-stay" className="px-4 py-3 bg-white text-stone-950 hover:bg-stone-200 transition-colors">예약하기</Link>
          <a href="https://lab.voidanchae.com" target="_blank" rel="noopener noreferrer" className="px-3 py-3 text-stone-300 hover:text-white">Lab</a>
          <Link href="/admin" className="px-3 py-3 text-stone-300 hover:text-white">관리자</Link>
        </div>
        <div className="flex lg:hidden shrink-0 items-center gap-1">
          <Link href="/#find-stay" onClick={closeMenu} className="px-3 py-3 whitespace-nowrap rounded-full bg-[#eee8dc] text-xs font-medium text-stone-950 hover:bg-white">예약하기</Link>
          <button ref={toggleRef} type="button" onClick={() => setMobileOpen(value => !value)} aria-label={mobileOpen ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={mobileOpen} aria-controls="public-mobile-menu" className="p-3 -mr-2 text-stone-200 hover:text-white min-h-[44px] min-w-[44px] inline-flex items-center justify-center">
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div id="public-mobile-menu" className="lg:hidden max-h-[calc(100dvh-72px)] overflow-y-auto bg-stone-950 border-t border-white/10 px-4 py-4 shadow-2xl">
          {NAV_LINKS.map(link => (
            <Link key={link.href} href={link.href} onClick={closeMenu} aria-current={isActive(link.href) ? 'page' : undefined} className={`block px-3 py-4 rounded-lg text-base ${isActive(link.href) ? 'text-white' : 'text-stone-300 hover:text-white'}`}>
              {link.label}
            </Link>
          ))}
          <div className="flex gap-4 border-t border-white/10 mt-3 pt-3 text-xs text-stone-300">
            <a href="https://lab.voidanchae.com" target="_blank" rel="noopener noreferrer" onClick={closeMenu} className="py-3 hover:text-white">Lab</a>
            <Link href="/admin" onClick={closeMenu} className="py-3 hover:text-white">관리자</Link>
          </div>
        </div>
      )}
    </nav>
  );
}
