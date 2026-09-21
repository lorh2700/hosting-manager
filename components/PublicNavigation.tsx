'use client';

import { usePublicLanguage, PublicLanguageSwitch } from '@/components/PublicLanguage';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import { Logo } from '@/components/Logo';
import styles from './PublicNavigation.module.css';

const NAV_LINKS = [
  { href: '/brand', label: '브랜드' },
  { href: '/#spaces', label: '공간' },
  { href: '/tours', label: '투어' },
  { href: '/about', label: '입점 안내' },
];

export function PublicNavigation() {
  const pathname = usePathname();
  return <Navigation key={pathname} pathname={pathname} />;
}

function Navigation({ pathname }: { pathname: string }) {
  const { t } = usePublicLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [mobileTourOpen, setMobileTourOpen] = useState(false);
  const tourRef = useRef<HTMLDivElement>(null);
  const tourToggleRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const closeMenu = () => { setMobileOpen(false); setMobileTourOpen(false); setTourOpen(false); };

  useEffect(() => {
    if (!tourOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !tourRef.current?.contains(event.target)) setTourOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setTourOpen(false); tourToggleRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [tourOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
        toggleRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) closeMenu();
    };
    const desktop = window.matchMedia('(min-width: 1024px)');
    const onBreakpoint = () => { if (desktop.matches) closeMenu(); };
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
    <nav ref={navRef} aria-label={t("주 메뉴")} className={`fixed top-0 left-0 right-0 z-50 transition-[padding] duration-300 motion-reduce:transition-none ${tourOpen ? 'lg:pb-40' : 'lg:pb-0'} bg-stone-950/95 ${pathname.startsWith('/guide') ? 'lg:bg-stone-950/95' : 'lg:bg-stone-950/55'} backdrop-blur-md border-b border-white/[0.06]`}>
      <div className="flex justify-between items-center gap-3 px-4 sm:px-6 md:px-8 h-16 md:h-[72px]">
        <Link href="/" aria-label={t("void anchae 홈")} onClick={closeMenu} className="flex items-center shrink-0 max-sm:w-[110px] hover:opacity-80 transition-opacity">
          <Logo width={140} className="max-w-full" priority />
        </Link>
        <div className="hidden lg:flex items-center gap-5 text-sm">
          {NAV_LINKS.map(link => (
            link.href === '/tours' ? <div key={link.href} ref={tourRef} className="relative" onPointerEnter={event => { if (event.pointerType === 'mouse') setTourOpen(true); }} onPointerLeave={event => { if (event.pointerType === 'mouse') setTourOpen(false); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setTourOpen(false); }}>
              <button ref={tourToggleRef} type="button" aria-expanded={tourOpen} aria-controls="public-tour-submenu" onClick={event => { if (event.detail === 0) setTourOpen(value => !value); }} onPointerUp={event => { if (event.pointerType !== 'mouse') setTourOpen(value => !value); }} className={`flex min-h-11 items-center gap-2 rounded-lg px-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${tourOpen || isActive('/tours') || isActive('/guide') ? 'text-white' : 'text-stone-300 hover:text-white'}`}>
                {t('투어')}<ChevronDown size={15} className={`transition-transform duration-200 motion-reduce:transition-none ${tourOpen ? 'rotate-180' : ''}`} />
              </button>
              <div id="public-tour-submenu" data-open={tourOpen} aria-hidden={!tourOpen} inert={!tourOpen} className={`${styles.submenu} absolute left-0 top-full w-56`}><div className={styles.content}>
                <Link href="/tours" aria-current={isActive('/tours') ? 'page' : undefined} onClick={() => setTourOpen(false)} className="block px-3 py-3 text-stone-300 transition-colors hover:text-white focus-visible:text-white">{t('투어 둘러보기')}</Link>
                <Link href="/guide" aria-current={pathname === '/guide' ? 'page' : undefined} onClick={() => setTourOpen(false)} className="block px-3 py-3 text-stone-300 transition-colors hover:text-white focus-visible:text-white">{t('북촌 가이드')}</Link>
                <Link href="/guide/yeongju" aria-current={isActive('/guide/yeongju') ? 'page' : undefined} onClick={() => setTourOpen(false)} className="block px-3 py-3 text-stone-300 transition-colors hover:text-white focus-visible:text-white">{t('영주 가이드')}</Link>
              </div></div>
            </div> :
            <Link key={link.href} href={link.href} aria-current={isActive(link.href) ? 'page' : undefined} className={`py-3 transition-colors ${isActive(link.href) ? 'text-white' : 'text-stone-300 hover:text-white'}`}>
              {t(link.label)}
            </Link>
          ))}
        </div>
        <div className="hidden lg:flex items-center gap-3 text-xs"><PublicLanguageSwitch />
          <Link href="/#find-stay" className="px-4 py-3 bg-white text-stone-950 hover:bg-stone-200 transition-colors">{t("예약하기")}</Link>
          <a href="https://lab.voidanchae.com" target="_blank" rel="noopener noreferrer" className="px-3 py-3 text-stone-300 hover:text-white">Lab</a>
          <Link href="/admin" className="px-3 py-3 text-stone-300 hover:text-white">{t("관리자")}</Link>
        </div>
        <div className="flex lg:hidden shrink-0 items-center gap-1"><PublicLanguageSwitch />
          <Link href="/#find-stay" onClick={closeMenu} className="px-3 py-3 whitespace-nowrap rounded-full bg-[#eee8dc] text-xs font-medium text-stone-950 hover:bg-white">{t("예약하기")}</Link>
          <button ref={toggleRef} type="button" onClick={() => { if (mobileOpen) closeMenu(); else setMobileOpen(true); }} aria-label={mobileOpen ? t("메뉴 닫기") : t("메뉴 열기")} aria-expanded={mobileOpen} aria-controls="public-mobile-menu" className="p-3 -mr-2 text-stone-200 hover:text-white min-h-[44px] min-w-[44px] inline-flex items-center justify-center">
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div id="public-mobile-menu" className="public-menu-reveal lg:hidden max-h-[calc(100dvh-72px)] overflow-y-auto bg-stone-950 border-t border-white/10 px-4 py-4 shadow-2xl">
          {NAV_LINKS.map(link => (
            link.href === '/tours' ? <div key={link.href} onPointerEnter={event => { if (event.pointerType === 'mouse') setMobileTourOpen(true); }} onPointerLeave={event => { if (event.pointerType === 'mouse') setMobileTourOpen(false); }}>
              <button type="button" aria-expanded={mobileTourOpen} aria-controls="public-mobile-tour-submenu" onClick={event => { if (event.detail === 0) setMobileTourOpen(value => !value); }} onPointerUp={event => { if (event.pointerType !== 'mouse') setMobileTourOpen(value => !value); }} className="flex w-full items-center justify-between px-3 py-4 text-base text-stone-200 hover:text-white">
                {t('투어')}<ChevronDown size={18} className={`transition-transform duration-200 motion-reduce:transition-none ${mobileTourOpen ? 'rotate-180' : ''}`} />
              </button>
              <div id="public-mobile-tour-submenu" data-open={mobileTourOpen} aria-hidden={!mobileTourOpen} inert={!mobileTourOpen} className={styles.submenu}><div className={`${styles.content} pl-4`}>
                <Link href="/tours" onClick={closeMenu} aria-current={isActive('/tours') ? 'page' : undefined} className="block px-3 py-3 text-sm text-stone-300 hover:text-white">{t('투어 둘러보기')}</Link>
                <Link href="/guide" onClick={closeMenu} aria-current={pathname === '/guide' ? 'page' : undefined} className={`block px-3 py-3 text-sm ${isActive('/guide') ? 'text-white' : 'text-stone-300 hover:text-white'}`}>{t('북촌 가이드')}</Link>
                <Link href="/guide/yeongju" onClick={closeMenu} aria-current={isActive('/guide/yeongju') ? 'page' : undefined} className={`block px-3 py-3 text-sm ${isActive('/guide/yeongju') ? 'text-white' : 'text-stone-300 hover:text-white'}`}>{t('영주 가이드')}</Link>
              </div></div>
            </div> :
            <Link key={link.href} href={link.href} onClick={closeMenu} aria-current={isActive(link.href) ? 'page' : undefined} className={`block px-3 py-4 rounded-lg text-base ${isActive(link.href) ? 'text-white' : 'text-stone-300 hover:text-white'}`}>
              {t(link.label)}
            </Link>
          ))}
          <div className="flex gap-4 border-t border-white/10 mt-3 pt-3 text-xs text-stone-300">
            <a href="https://lab.voidanchae.com" target="_blank" rel="noopener noreferrer" onClick={closeMenu} className="py-3 hover:text-white">Lab</a>
            <Link href="/admin" onClick={closeMenu} className="py-3 hover:text-white">{t("관리자")}</Link>
          </div>
        </div>
      )}
    </nav>
  );
}
