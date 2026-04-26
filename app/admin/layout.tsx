'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { useAuth } from '@/components/AuthProvider';
import { Logo } from '@/components/Logo';

const PUBLIC_PATHS = ['/admin/calendar'];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const pathname = usePathname();

  const isPublicPath = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (!loading && profile?.role === 'cleaner') {
      router.replace('/cleaner');
    }
  }, [loading, profile, router]);

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
        // Refresh auth context after successful login
        window.location.reload();
      }
    } catch (err) {
      setError('로그인에 실패했습니다.');
      console.error('Login failed', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (loading && !isPublicPath) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b0b0c]">
        <div className="w-7 h-7 border-2 border-white/15 border-t-violet-400 rounded-full animate-spin" />
      </div>
    );
  }

  // Public paths: skip login, render without sidebar
  if (isPublicPath && !profile) {
    return (
      <div className="min-h-screen bg-[#0b0b0c] font-sans text-white selection:bg-violet-500/30">
        <main className="p-4 pb-24 md:p-8 lg:p-12 md:pb-12 overflow-y-auto">
          {children}
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0b0b0c] p-5 font-sans">
        <div className="mb-9">
          <Logo width={200} priority />
        </div>
        <div className="bg-[#141416] rounded-2xl p-8 sm:p-10 border border-white/[0.06] max-w-md w-full">
          <h1 className="text-xl font-semibold text-white mb-1.5">호스트 로그인</h1>
          <p className="text-white/50 mb-7 text-sm">숙소를 관리하려면 로그인하세요.</p>

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

  if (profile?.role === 'cleaner') return null;

  if (profile?.status === 'suspended') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0b0b0c] p-5 font-sans">
        <div className="bg-[#141416] rounded-2xl p-8 border border-rose-500/25 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold text-white mb-2">계정 비활성화</h1>
          <p className="text-white/55 text-sm">계정이 비활성화되었습니다. 관리자에게 문의하세요.</p>
        </div>
      </div>
    );
  }

  if (profile?.status === 'pending_invite') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0b0b0c] p-5 font-sans">
        <div className="bg-[#141416] rounded-2xl p-8 border border-amber-500/25 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold text-white mb-2">승인 대기중</h1>
          <p className="text-white/55 text-sm">관리자의 승인을 기다리고 있습니다. 잠시만 기다려주세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#0b0b0c] font-sans text-white selection:bg-violet-500/30">
      <Sidebar />
      <main className="flex-1 px-4 pt-4 pb-28 md:px-8 md:pt-8 md:pb-12 lg:px-10 lg:pt-10 overflow-y-auto min-w-0">
        {children}
      </main>
    </div>
  );
}
