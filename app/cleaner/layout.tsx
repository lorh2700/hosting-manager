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
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505] p-4 font-sans">
        <div className="bg-[#111] p-10 border border-white/10 max-w-md w-full">
          <h1 className="text-2xl font-light tracking-widest text-white mb-2 uppercase">청소 담당자 로그인</h1>
          <p className="text-white/50 mb-8 text-sm font-light tracking-wide">청소 일정을 확인하려면 로그인하세요.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">이메일</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
                placeholder="example@email.com"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-red-400 text-xs">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-white text-black py-4 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 mt-2"
            >
              {isLoggingIn ? (
                <>
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
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
    <div className="min-h-screen bg-[#050505] font-sans text-white selection:bg-white/20">
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <span className="text-sm tracking-[0.2em] font-medium text-white">void anchae</span>
        <div className="flex items-center gap-4">
          {profile?.displayName && (
            <span className="text-[10px] tracking-widest text-white/40 uppercase hidden sm:inline">
              {profile.displayName}
            </span>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/40 hover:text-white transition-colors"
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

      {/* 하단 네비게이션 */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[#111] border-t border-white/10 z-50">
        <div className="max-w-2xl mx-auto flex">
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href || (item.href !== '/cleaner' && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
                  isActive ? 'text-white' : 'text-white/30 hover:text-white/50'
                }`}
              >
                <Icon size={18} />
                <span className="text-[9px] uppercase tracking-widest font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
