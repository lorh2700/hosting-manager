'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

interface InvitationData {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
}

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const { user, refreshProfile } = useAuth();

  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function loadInvitation() {
      try {
        const res = await fetch(`/api/invitations/${token}`);
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || '유효하지 않거나 만료된 초대 링크입니다.');
          setLoading(false);
          return;
        }

        setInvitation(data);
      } catch (e) {
        console.error('Failed to load invitation:', e);
        setError('초대 정보를 불러오는 데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    }

    loadInvitation();
  }, [token]);

  // If user is already logged in with matching email, auto-accept
  useEffect(() => {
    if (user && invitation && user.email === invitation.email) {
      refreshProfile().then(() => {
        router.push('/admin');
      });
    }
  }, [user, invitation]);

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitation) return;

    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }

    if (password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      // Try to register new account
      const registerRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: invitation.email,
          password,
          displayName: invitation.email,
        }),
      });

      if (registerRes.ok) {
        // Registration successful, profile auto-created with invitation data
        await refreshProfile();
        router.push('/admin');
        return;
      }

      const registerData = await registerRes.json();

      // If email already exists, try logging in
      if (registerRes.status === 409) {
        const loginRes = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: invitation.email,
            password,
          }),
        });

        if (loginRes.ok) {
          await refreshProfile();
          router.push('/admin');
          return;
        }

        const loginData = await loginRes.json();
        setError(loginData.error || '이미 계정이 존재합니다. 올바른 비밀번호를 입력하세요.');
      } else {
        setError(registerData.error || '계정 생성에 실패했습니다. 다시 시도해주세요.');
      }
    } catch (err: unknown) {
      setError('계정 생성에 실패했습니다. 다시 시도해주세요.');
      console.error('Accept invitation error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const roleLabels: Record<string, string> = {
    admin: '관리자',
    manager: '매니저',
    cleaner: '청소담당자',
    // 옛 초대 레코드 호환
    super_admin: '관리자',
    host: '매니저',
    viewer: '매니저',
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505] p-4 font-sans">
        <div className="bg-[#111] p-10 border border-red-500/30 max-w-md w-full text-center">
          <h1 className="text-xl font-light tracking-widest text-white mb-4 uppercase">초대 오류</h1>
          <p className="text-white/50 text-sm font-light">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="mt-6 text-white/60 text-xs hover:text-white transition-colors"
          >
            홈으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505] p-4 font-sans">
      <div className="bg-[#111] p-10 border border-white/10 max-w-md w-full">
        <h1 className="text-2xl font-light tracking-widest text-white mb-2 uppercase">초대 수락</h1>
        <p className="text-white/50 mb-2 text-sm font-light tracking-wide">
          void anchae에 초대되었습니다.
        </p>
        <div className="flex gap-4 mb-8 text-xs text-white/40">
          <span>이메일: <span className="text-white/70">{invitation?.email}</span></span>
          <span>역할: <span className="text-white/70">{roleLabels[invitation?.role ?? ''] ?? invitation?.role}</span></span>
        </div>

        <form onSubmit={handleAccept} className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              placeholder="6자 이상"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">비밀번호 확인</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-white text-black py-4 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 mt-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                처리 중...
              </>
            ) : (
              '초대 수락 및 가입'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
