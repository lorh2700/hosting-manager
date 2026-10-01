'use client';

import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useTransition, type ComponentProps, type ReactNode } from 'react';
import styles from './NavigationFeedback.module.css';

const NavigationContext = createContext<null | ((href: string, replace?: boolean, scroll?: boolean) => void)>(null);

export function NavigationFeedbackProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function navigate(href: string, replace = false, scroll = true) {
    startTransition(() => { if (replace) router.replace(href, { scroll }); else router.push(href, { scroll }); });
  }
  return <NavigationContext.Provider value={navigate}>
    {children}
    {pending && <div className={styles.progress} role="status" aria-live="polite"><span className={styles.track} /><span className={styles.label}>페이지 이동 중…</span></div>}
  </NavigationContext.Provider>;
}

export function NavigationLink({ onNavigate, ...props }: ComponentProps<typeof NextLink>) {
  const navigate = useContext(NavigationContext);
  return <NextLink {...props} onNavigate={event => {
    let cancelled = false;
    onNavigate?.({ preventDefault: () => { cancelled = true; event.preventDefault(); } });
    if (cancelled || !navigate || typeof props.href !== 'string') return;
    const target = new URL(props.href, window.location.href);
    if (target.origin !== window.location.origin || (target.pathname === window.location.pathname && target.search === window.location.search)) return;
    event.preventDefault();
    navigate(target.pathname + target.search + target.hash, props.replace, props.scroll);
  }} />;
}

export function PageLoading() {
  return <div className={styles.loading} role="status" aria-live="polite"><span className={styles.spinner} aria-hidden="true" /><p>화면을 불러오는 중…</p></div>;
}
