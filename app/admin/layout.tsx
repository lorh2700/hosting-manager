'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { useAuth } from '@/components/AuthProvider';
import { useAdminMode } from '@/lib/adminMode';
import { NavigationLink } from '@/components/NavigationFeedback';
import styles from './AdminShell.module.css';
import { canUseModule, isModuleEnabled, moduleForAdminPath } from '@/lib/operational-permissions';
import { getAdminNavigation } from '@/lib/admin-navigation';
import AuthSessionNotice from '@/components/AuthSessionNotice';
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, error, refreshProfile } = useAuth();
  const { mode } = useAdminMode();
  const router = useRouter(); const pathname = usePathname();
  useEffect(() => {
    if (loading || error) return;
    if (!user) router.replace('/login?next=' + encodeURIComponent(pathname + window.location.search));
    else if (profile?.role === 'cleaner') router.replace('/cleaner');
  }, [loading, error, user, profile?.role, pathname, router]);
  if (error && !loading) return <AuthSessionNotice error={error} onRetry={refreshProfile} />;
  if (loading || !user) return <div role="status" className="min-h-dvh grid place-items-center text-stone-600">로그인 확인 중…</div>;
  if (profile?.role === 'cleaner') return null;

  if (profile?.status === 'suspended') {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-stone-50 p-5 font-sans">
        <div className="bg-white p-8 border-l-2 border border-stone-200 border-l-rose-500 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold text-stone-900 mb-2">계정 비활성화</h1>
          <p className="text-stone-600 text-sm">계정이 비활성화되었습니다. 관리자에게 문의하세요.</p>
        </div>
      </div>
    );
  }

  if (profile?.status === 'pending_invite') {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-stone-50 p-5 font-sans">
        <div className="bg-white p-8 border-l-2 border border-stone-200 border-l-amber-500 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold text-stone-900 mb-2">승인 대기중</h1>
          <p className="text-stone-600 text-sm">관리자의 승인을 기다리고 있습니다. 잠시만 기다려주세요.</p>
        </div>
      </div>
    );
  }

  const operationalModule = pathname === '/admin' && mode === 'tour' ? 'tours' : moduleForAdminPath(pathname);
  const administratorPage = (pathname === '/admin/settings' || pathname.startsWith('/admin/settings/operations') || pathname.startsWith('/admin/activity'));
  const allowed = !!profile && (!administratorPage || ['super_admin', 'admin'].includes(profile.role))
    && (!operationalModule || profile.role === 'super_admin' || (canUseModule(profile.role, profile.enabledModules, operationalModule) && isModuleEnabled(operationalModule, profile.organizationFeatures)));
  const firstPermitted = profile ? getAdminNavigation(mode, profile.role, profile).groups.flatMap(group => group.items).find(item => item.href !== '/admin/settings/profile') : undefined;

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.content}>
        <header className={styles.chrome}>
          <span className={styles.mode}>{profile?.role === 'super_admin' ? '슈퍼매니저' : profile?.organizationName || (mode === 'tour' ? '투어 관리' : '숙박 관리')}</span>
          <NavigationLink href="/admin/settings/profile" className={styles.account} aria-label="내 계정">
            <span className={styles.avatar} aria-hidden="true">{(profile?.displayName || '관리자').slice(0, 1)}</span>
            <span className={styles.accountName}>{profile?.displayName || '관리자'}</span>
          </NavigationLink>
        </header>
        <main className={styles.main}>{allowed ? children : <section className="mx-auto max-w-lg border bg-white p-8"><h1 className="text-xl font-semibold">사용 권한이 없는 메뉴입니다.</h1><p className="mt-3 text-sm text-stone-500">사업자 관리자에게 담당 숙소와 메뉴 권한을 확인해 주세요.</p><NavigationLink className="mt-6 inline-flex min-h-11 items-center border px-4 text-sm" href={firstPermitted?.href || '/admin/settings/profile'}>사용 가능한 메뉴로 이동</NavigationLink></section>}</main>
      </div>
    </div>
  );
}
