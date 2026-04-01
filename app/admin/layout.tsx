'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { useAuth } from '@/components/FirebaseProvider';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, setDoc, collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { SEED_PROPERTIES } from '@/lib/seedData';

const SEEDED_ACCOUNTS = ['unwadang@gmail.com', 'lorh2700@gmail.com', 'alsemffp67@gmail.com'];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const router = useRouter();
  const hasSeededRef = useRef(false);

  useEffect(() => {
    const autoSeedData = async () => {
      if (!user || !SEEDED_ACCOUNTS.includes(user.email ?? '')) return;
      if (hasSeededRef.current) return;

      const sessionKey = `hasSeeded_${user.email?.split('@')[0]}`;
      if (sessionStorage.getItem(sessionKey)) return;
      sessionStorage.setItem(sessionKey, 'true');
      hasSeededRef.current = true;

      try {
        setIsSeeding(true);
        const q = query(collection(db, 'properties'), where('ownerId', '==', user.uid));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
          for (const prop of SEED_PROPERTIES) {
            const p = prop as typeof prop & {
              beds24PropId?: string;
              checkInTime?: string;
              checkOutTime?: string;
              address?: string;
              phone?: string;
              email?: string;
              permit?: string;
            };
            const propRef = await addDoc(collection(db, 'properties'), {
              name: p.name,
              timezone: p.timezone,
              beds24PropId: p.beds24PropId ?? null,
              checkInTime: p.checkInTime ?? null,
              checkOutTime: p.checkOutTime ?? null,
              address: p.address ?? null,
              phone: p.phone ?? null,
              email: p.email ?? null,
              permit: p.permit ?? null,
              ownerId: user.uid,
              createdAt: new Date().toISOString(),
            });

            for (const channel of prop.channels) {
              await addDoc(collection(db, 'channels'), {
                propertyId: propRef.id,
                name: channel.name,
                importUrl: channel.importUrl,
                exportUrl: `/api/export/${crypto.randomUUID()}.ics`,
                isActive: channel.isActive,
                createdAt: new Date().toISOString(),
              });
            }
          }

          if (window.location.pathname === '/admin/properties') {
            router.refresh();
          }
        }
      } catch (error) {
        console.error('Failed to auto-seed properties:', error);
      } finally {
        setIsSeeding(false);
      }
    };

    if (!loading) {
      autoSeedData();
    }
  }, [user, loading, router]);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);

      const userDoc = await getDoc(doc(db, 'users', result.user.uid));
      if (!userDoc.exists()) {
        await setDoc(doc(db, 'users', result.user.uid), {
          email: result.user.email,
          role: 'host',
          createdAt: new Date().toISOString(),
        });
      }
    } catch (error: unknown) {
      const e = error as { code?: string };
      if (e.code === 'auth/cancelled-popup-request' || e.code === 'auth/popup-closed-by-user') {
        // 사용자가 로그인을 취소함
      } else {
        console.error('Login failed', error);
        alert('로그인에 실패했습니다.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (loading || isSeeding) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505] gap-4">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin"></div>
        {isSeeding && (
          <p className="text-white/50 font-light tracking-widest text-[11px] uppercase animate-pulse">
            초기 데이터를 설정하는 중입니다...
          </p>
        )}
      </div>
    );
  }

  if (!user) {
    const isKakaoWebView = typeof navigator !== 'undefined' && /KAKAOTALK/i.test(navigator.userAgent);

    const openInBrowser = () => {
      const url = window.location.href;
      // Android: intent scheme to force Chrome
      const intentUrl = 'intent://' + url.replace(/https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
      window.location.href = intentUrl;
      // Fallback after 1s (iOS or no Chrome)
      setTimeout(() => {
        window.location.href = url;
      }, 1000);
    };

    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505] p-4 font-sans">
        <div className="bg-[#111] p-10 rounded-none border border-white/10 max-w-md w-full text-center">
          <h1 className="text-2xl font-light tracking-widest text-white mb-4 uppercase">호스트 로그인</h1>

          {isKakaoWebView ? (
            <>
              <p className="text-white/50 mb-3 text-sm font-light tracking-wide leading-relaxed">
                카카오톡 브라우저에서는 Google 로그인이 제한됩니다.
              </p>
              <p className="text-white/30 mb-8 text-xs font-light leading-relaxed">
                아래 버튼을 눌러 Chrome 브라우저에서 열어주세요.
              </p>
              <button
                onClick={openInBrowser}
                className="w-full bg-white text-black py-4 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors flex items-center justify-center gap-3"
              >
                Chrome으로 열기
              </button>
              <p className="text-white/20 mt-4 text-[10px] leading-relaxed">
                버튼이 작동하지 않으면 주소창 우측 메뉴 → &apos;다른 브라우저로 열기&apos;를 선택하세요.
              </p>
            </>
          ) : (
            <>
              <p className="text-white/50 mb-10 text-sm font-light tracking-wide">void anchae 숙소를 관리하려면 로그인하세요.</p>
              <button
                onClick={handleLogin}
                disabled={isLoggingIn}
                className="w-full bg-white text-black py-4 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              >
                {isLoggingIn ? (
                  <>
                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                    로그인 중...
                  </>
                ) : (
                  'Google 계정으로 로그인'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#050505] font-sans text-white selection:bg-white/20">
      <Sidebar />
      <main className="flex-1 p-8 md:p-12 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
