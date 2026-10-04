'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { NavigationLink as Link } from '@/components/NavigationFeedback';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home, ClipboardList, CalendarDays, BookOpen, MessageSquare, Users, UserCog,
  LogOut, CircleUserRound, Menu, X, FileBarChart, Compass, Briefcase,
  CalendarCheck, Hand, KeyRound, Plane, Package, CircleAlert, Plug,
  CreditCard, ChevronDown, ArrowUpRight, Settings, History,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Logo } from '@/components/Logo';
import { useAdminMode, clearAdminMode } from '@/lib/adminMode';
import { getAdminNavigation, isAdminNavActive, type AdminNavIcon, type AdminNavItem } from '@/lib/admin-navigation';
import styles from './Sidebar.module.css';

const ICONS: Record<AdminNavIcon, typeof Home> = {
  home: Home, calendar: CalendarDays, bookings: BookOpen, messages: MessageSquare,
  cleaning: Hand, laundry: Briefcase, issues: CircleAlert, supplies: Package,
  report: FileBarChart, payments: CreditCard, properties: Home, staff: UserCog,
  guests: Users, pickup: Plane, integrations: Plug, api: KeyRound, account: CircleUserRound,
  tours: Compass, 'tour-bookings': CalendarCheck, 'tour-operators': Briefcase,
  'my-cleaning': ClipboardList,
  settings: Settings, activity: History,
};

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile } = useAuth();
  const role = profile?.role ?? 'manager';
  const { mode } = useAdminMode();
  const navigation = useMemo(() => getAdminNavigation(mode, role, profile ?? {}), [mode, role, profile]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const modeLabel = mode === 'tour' ? '투어 관리' : '숙박 관리';
  const ModeIcon = mode === 'tour' ? Compass : Home;

  useEffect(() => {
    setMoreOpen(false);
    const activeGroup = navigation.groups.find(group => group.items.some(item => isAdminNavActive(pathname, item.href)));
    if (activeGroup && !activeGroup.alwaysOpen) setExpanded(previous => ({ ...previous, [activeGroup.id]: true }));
  }, [pathname, navigation]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!moreOpen) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = () => { if (desktop.matches) setMoreOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    closeOnDesktop();
    return () => {
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener('change', closeOnDesktop);
      if (dialog.open) dialog.close();
    };
  }, [moreOpen]);

  const closeMenu = () => setMoreOpen(false);
  const isMoreActive = [...navigation.groups.flatMap(group => group.items), ...navigation.secondary]
    .some(item => !navigation.primary.some(primary => primary.href === item.href) && isAdminNavActive(pathname, item.href));

  async function handleLogout() {
    if (logoutPending) return;
    setLogoutPending(true);
    setLogoutError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('로그아웃하지 못했습니다. 다시 시도해주세요.');
      clearAdminMode();
      closeMenu();
      router.replace('/login');
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : '로그아웃하지 못했습니다. 다시 시도해주세요.');
      setLogoutPending(false);
    }
  }

  function renderLink(item: AdminNavItem, mobileSheet = false) {
    const active = isAdminNavActive(pathname, item.href);
    const Icon = ICONS[item.icon];
    return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
      onClick={mobileSheet ? closeMenu : undefined}
      className={`${styles.link} ${active ? styles.active : ''}`}>
      <Icon size={18} strokeWidth={active ? 2 : 1.7} aria-hidden="true" />
      <span>{item.label}</span>
    </Link>;
  }

  const logout = <button type="button" onClick={() => void handleLogout()} className={styles.logout} disabled={logoutPending}>
    <LogOut size={17} strokeWidth={1.7} aria-hidden="true" />
    <span>{logoutPending ? '로그아웃 중…' : '로그아웃'}</span>
  </button>;

  return <>
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <Link href="/admin" aria-label="void anchae 관리자 홈"><Logo width={148} variant="black" priority /></Link>
        <Link href="/" className={styles.portal}>예약 포털 <ArrowUpRight size={14} aria-hidden="true" /></Link>
      </div>
      <div className={styles.mode} title="로그인할 때 선택한 관리 영역입니다.">
        <ModeIcon size={17} aria-hidden="true" /><span>{modeLabel}</span>
      </div>
      <nav className={styles.desktopNav} aria-label={`${modeLabel} 메뉴`}>
        {navigation.groups.map(group => {
          const open = group.alwaysOpen || (expanded[group.id] ?? group.items.some(item => isAdminNavActive(pathname, item.href)));
          const contentId = `admin-nav-${group.id}`;
          return <section className={styles.group} key={group.id}>
            {group.alwaysOpen ? <h2 className={styles.groupTitle}>{group.label}</h2> :
              <button type="button" className={styles.groupToggle} aria-expanded={Boolean(open)} aria-controls={contentId}
                onClick={() => setExpanded(previous => ({ ...previous, [group.id]: !open }))}>
                <span>{group.label}</span><ChevronDown size={15} className={open ? styles.chevronOpen : ''} aria-hidden="true" />
              </button>}
            <div id={contentId} hidden={!open}>{group.items.map(item => renderLink(item))}</div>
          </section>;
        })}
        {navigation.secondary.length > 0 && <div className={styles.secondary}>{navigation.secondary.map(item => renderLink(item))}</div>}
      </nav>
      <div className={styles.account}>
        <p className={styles.accountName}>{profile?.displayName || user?.email}</p>
        {profile?.displayName && <p className={styles.email}>{user?.email}</p>}
        {logout}
        {logoutError && <p role="alert" className={styles.logoutError}>{logoutError}</p>}
      </div>
    </aside>

    <nav className={styles.bottomNav} aria-label="주요 관리자 메뉴">
      {navigation.primary.map(item => {
        const active = isAdminNavActive(pathname, item.href);
        const Icon = ICONS[item.icon];
        return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
          className={`${styles.bottomItem} ${active ? styles.bottomActive : ''}`}>
          <Icon size={21} strokeWidth={active ? 2 : 1.7} aria-hidden="true" />
          <span>{item.mobileLabel ?? item.label}</span>
        </Link>;
      })}
      <button type="button" ref={menuButtonRef} aria-haspopup="dialog" aria-expanded={moreOpen} aria-controls="admin-menu-sheet"
        onClick={() => setMoreOpen(true)} className={`${styles.bottomItem} ${moreOpen || isMoreActive ? styles.bottomActive : ''}`}>
        <Menu size={21} strokeWidth={1.7} aria-hidden="true" /><span>전체 메뉴</span>
      </button>
    </nav>

    <dialog id="admin-menu-sheet" ref={dialogRef} className={styles.dialog} aria-labelledby="admin-menu-title"
      onCancel={closeMenu} onClose={() => { closeMenu(); menuButtonRef.current?.focus(); }}
      onClick={event => { if (event.target === event.currentTarget) closeMenu(); }}>
      <div className={styles.sheet}>
        <header className={styles.sheetHeader}>
          <div><h2 id="admin-menu-title">전체 메뉴</h2><p>{modeLabel}</p></div>
          <button type="button" className={styles.closeButton} aria-label="전체 메뉴 닫기" autoFocus onClick={closeMenu}>
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        <nav className={styles.sheetNav} aria-label={`${modeLabel} 전체 메뉴`}>
          {navigation.groups.map(group => <section className={styles.sheetGroup} key={group.id}>
            <h3>{group.label}</h3><div>{group.items.map(item => renderLink(item, true))}</div>
          </section>)}
          {navigation.secondary.length > 0 && <section className={styles.sheetGroup}>
            <h3>내 업무</h3><div>{navigation.secondary.map(item => renderLink(item, true))}</div>
          </section>}
        </nav>
        <footer className={styles.sheetFooter}>
          <p className={styles.accountName}>{profile?.displayName || user?.email}</p>
          {logout}
          {logoutError && <p role="alert" className={styles.logoutError}>{logoutError}</p>}
        </footer>
      </div>
    </dialog>
  </>;
}
