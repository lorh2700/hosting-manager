'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { CalendarDays, AlertTriangle, Package, History, ClipboardList, LogOut } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/cleaner', label: '오늘', icon: ClipboardList },
  { href: '/cleaner/schedule', label: '일정', icon: CalendarDays },
  { href: '/cleaner/issues', label: '이슈', icon: AlertTriangle },
  { href: '/cleaner/supplies', label: '비품', icon: Package },
  { href: '/cleaner/history', label: '기록', icon: History },
];

export default function CleanerLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && profile && profile.role !== 'cleaner' && profile.role !== 'super_admin') {
      router.replace('/admin');
    }
  }, [loading, profile, router]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout failed', err);
    } finally {
      window.location.href = '/login';
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '로그인에 실패했습니다.');
      } else {
        window.location.reload();
      }
    } catch (err: unknown) {
      setError('로그인에 실패했습니다.');
      console.error('Login failed', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b0b0c]">
        <div className="w-7 h-7 border-2 border-white/15 border-t-violet-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0b0b0c] p-5 font-sans">
        <div className="bg-[#141416] rounded-2xl p-8 sm:p-10 border border-white/[0.06] max-w-md w-full">
          <h1 className="text-xl font-semibold text-white mb-1.5">청소 담당자 로그인</h1>
          <p className="text-white/50 mb-7 text-sm">청소 일정을 확인하려면 로그인하세요.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs text-white/55 mb-2">이메일</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full bg-black/30 border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-400/60 transition-colors"
                placeholder="example@email.com"
              />
            </div>
            <div>
              <label className="block text-xs text-white/55 mb-2">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full bg-black/30 border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-400/60 transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-rose-400 text-xs">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-violet-500 hover:bg-violet-400 text-white py-3.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
            >
              {isLoggingIn ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  로그인 중...
                </>
              ) : (
                '로그인'
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (profile && profile.role !== 'cleaner' && profile.role !== 'super_admin') return null;

  return (
    <div className="min-h-screen bg-[#0b0b0c] font-sans text-white selection:bg-violet-500/30">
      <header className="border-b border-white/[0.06] px-5 py-4 flex items-center justify-between">
        <span className="text-sm font-semibold text-white tracking-tight">void anchae</span>
        <div className="flex items-center gap-4">
          {profile?.displayName && (
            <span className="text-xs text-white/55 hidden sm:inline">{profile.displayName}</span>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs text-white/55 hover:text-white transition-colors"
            aria-label="로그아웃"
          >
            <LogOut size={14} />
            <span>로그아웃</span>
          </button>
        </div>
      </header>
      <main className="p-4 pb-28 md:p-8 md:pb-28 max-w-2xl mx-auto">
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-[#0b0b0c]/95 backdrop-blur-lg border-t border-white/[0.06] z-50 safe-bottom">
        <div className="max-w-2xl mx-auto flex">
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href || (item.href !== '/cleaner' && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors active:scale-95 ${
                  isActive ? 'text-white' : 'text-white/45'
                }`}
              >
                <Icon size={20} strokeWidth={isActive ? 2 : 1.7} className={isActive ? 'text-violet-300' : ''} />
                <span className="text-[10.5px] leading-none">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
