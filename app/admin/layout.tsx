'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { useAuth } from '@/components/FirebaseProvider';
import { signInWithEmailAndPassword, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const PUBLIC_PATHS = ['/admin/calendar'];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState('');
  const [anonReady, setAnonReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const isPublicPath = PUBLIC_PATHS.includes(pathname);

  // Anonymous auth for public paths
  useEffect(() => {
    if (!isPublicPath || user) return;
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setAnonReady(true);
      } else {
        signInAnonymously(auth).catch(console.error);
      }
    });
    return () => unsub();
  }, [isPublicPath, user]);

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
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found') {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      } else {
        setError('로그인에 실패했습니다.');
        console.error('Login failed', err);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (loading || (isPublicPath && !user && !anonReady)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  // Public paths: skip login, render without sidebar
  if (isPublicPath && !profile) {
    return (
      <div className="min-h-screen bg-[#050505] font-sans text-white selection:bg-white/20">
        <main className="p-4 pb-24 md:p-8 lg:p-12 md:pb-12 overflow-y-auto">
          {children}
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505] p-4 font-sans">
        <div className="bg-[#111] p-10 border border-white/10 max-w-md w-full">
          <h1 className="text-2xl font-light tracking-widest text-white mb-2 uppercase">호스트 로그인</h1>
          <p className="text-white/50 mb-8 text-sm font-light tracking-wide">void anchae 숙소를 관리하려면 로그인하세요.</p>

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

  if (profile?.role === 'cleaner') return null;

  if (profile?.status === 'suspended') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505] p-4 font-sans">
        <div className="bg-[#111] p-10 border border-red-500/30 max-w-md w-full text-center">
          <h1 className="text-xl font-light tracking-widest text-white mb-4 uppercase">계정 비활성화</h1>
          <p className="text-white/50 text-sm font-light">계정이 비활성화되었습니다. 관리자에게 문의하세요.</p>
        </div>
      </div>
    );
  }

  if (profile?.status === 'pending_invite') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505] p-4 font-sans">
        <div className="bg-[#111] p-10 border border-amber-500/30 max-w-md w-full text-center">
          <h1 className="text-xl font-light tracking-widest text-white mb-4 uppercase">승인 대기중</h1>
          <p className="text-white/50 text-sm font-light">관리자의 승인을 기다리고 있습니다. 잠시만 기다려주세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#050505] font-sans text-white selection:bg-white/20">
      <Sidebar />
      <main className="flex-1 p-4 pb-24 md:p-8 lg:p-12 md:pb-12 overflow-y-auto min-w-0">
        {children}
      </main>
    </div>
  );
}
