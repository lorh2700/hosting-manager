'use client';

/**
 * One-time bootstrap page.
 * Promotes the currently logged-in user to super_admin
 * ONLY if no super_admin exists in the users collection yet.
 *
 * Usage: log in first, then visit /setup
 * Delete or restrict this page once setup is complete.
 */

import { useState } from 'react';
import { collection, getDocs, doc, setDoc, query, where } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';

export default function SetupPage() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error' | 'blocked'>('idle');
  const [message, setMessage] = useState('');

  const handleSetup = async () => {
    setStatus('loading');
    try {
      const user = auth.currentUser;
      if (!user) {
        setStatus('error');
        setMessage('로그인 상태가 아닙니다. /admin 에서 로그인 후 다시 시도하세요.');
        return;
      }

      // Check if any super_admin already exists
      const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'super_admin')));
      if (!snap.empty) {
        setStatus('blocked');
        setMessage('이미 super_admin 계정이 존재합니다. 이 페이지는 더 이상 사용할 수 없습니다.');
        return;
      }

      // Also check for legacy 'admin' role
      const legacySnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'admin')));
      if (!legacySnap.empty) {
        setStatus('blocked');
        setMessage('기존 admin 계정이 존재합니다. /admin/users 에서 역할을 변경하거나 Firebase Console에서 직접 수정하세요.');
        return;
      }

      await setDoc(doc(db, 'users', user.uid), {
        email: user.email ?? '',
        displayName: user.displayName ?? user.email ?? '',
        role: 'super_admin',
        propertyIds: [],
        createdAt: new Date().toISOString(),
      }, { merge: true });

      setStatus('done');
      setMessage(`완료! ${user.email} 계정이 super_admin으로 설정되었습니다. /admin 으로 이동하세요.`);
    } catch (e) {
      setStatus('error');
      setMessage(`오류: ${e}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505] p-4 font-sans">
      <div className="bg-[#111] p-10 border border-white/10 max-w-md w-full">
        <h1 className="text-2xl font-light tracking-widest text-white mb-2 uppercase">초기 설정</h1>
        <p className="text-white/40 mb-8 text-xs leading-relaxed">
          super_admin 계정이 없을 때 한 번만 사용하는 페이지입니다.<br />
          먼저 <a href="/admin" className="underline hover:text-white">로그인</a>을 완료한 후 이 버튼을 누르세요.
        </p>

        {message && (
          <p className={`text-xs mb-6 leading-relaxed ${
            status === 'done' ? 'text-emerald-400' :
            status === 'blocked' ? 'text-amber-400' :
            'text-red-400'
          }`}>{message}</p>
        )}

        {status === 'done' ? (
          <a
            href="/admin"
            className="block w-full bg-white text-black py-4 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors text-center"
          >
            관리자 페이지로 이동
          </a>
        ) : (
          <button
            onClick={handleSetup}
            disabled={status === 'loading' || status === 'blocked'}
            className="w-full bg-white text-black py-4 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3"
          >
            {status === 'loading' ? (
              <>
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                처리 중...
              </>
            ) : status === 'blocked' ? (
              '이미 설정됨'
            ) : (
              '내 계정을 super_admin으로 설정'
            )}
          </button>
        )}
      </div>
    </div>
  );
}
