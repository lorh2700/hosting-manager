'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { completeInvitation } from './invitation-flow';

interface InvitationData {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  organizationName?: string | null;
  organization?: { name: string } | null;
  propertyNames?: string[];
}

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const { user, refreshProfile, loading: authLoading } = useAuth();

  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const matchingUser = !!user && !!invitation && user.email.trim().toLowerCase() === invitation.email.trim().toLowerCase();

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setInvitation(null);
    async function loadInvitation() {
      try {
        const res = await fetch(`/api/invitations/${encodeURIComponent(token)}`, { signal: controller.signal, cache: 'no-store' });
        const data = await res.json();
        if (controller.signal.aborted) return;

        if (!res.ok) {
          setError(data.error || '유효하지 않거나 만료된 초대 링크입니다.');
          setLoading(false);
          return;
        }

        setInvitation(data);
      } catch (e) {
        if (controller.signal.aborted) return;
        console.error('Failed to load invitation:', e);
        setError('초대 정보를 불러오는 데 실패했습니다.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadInvitation();
    return () => controller.abort();
  }, [token]);

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitation || isSubmitting) return;

    if (!matchingUser && password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }

    if (!matchingUser && password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const result = await completeInvitation({ token, email: invitation.email, role: invitation.role, password, signedInEmail: user?.email });
      await refreshProfile();
      router.push(result.role === 'cleaner' ? '/cleaner' : '/admin');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '초대를 수락하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  async function switchAccount() {
    setIsSubmitting(true); setError('');
    try { const response = await fetch('/api/auth/logout', { method: 'POST' }); if (!response.ok) throw new Error('로그아웃하지 못했습니다. 다시 시도해 주세요.'); await refreshProfile(); router.replace(`/login?next=${encodeURIComponent(`/invite/${token}`)}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '계정을 전환하지 못했습니다.'); setIsSubmitting(false); }
  }

  const roleLabels: Record<string, string> = {
    admin: '사업자 관리자',
    manager: '매니저',
    cleaner: '청소담당자',
    // 옛 초대 레코드 호환
    super_admin: '슈퍼매니저',
    host: '매니저',
    viewer: '매니저',
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#050505]">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-[#050505] p-4 font-sans">
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
    <div className="min-h-dvh flex flex-col items-center justify-center bg-[#050505] p-4 font-sans">
      <div className="bg-[#111] p-6 sm:p-10 border border-white/10 max-w-md w-full">
        <h1 className="text-2xl font-light tracking-widest text-white mb-2 uppercase">초대 수락</h1>
        <p className="text-white/50 mb-2 text-sm font-light tracking-wide">
          void anchae에 초대되었습니다.
        </p>
        <div className="flex flex-col gap-2 mb-6 text-xs text-white/40">
          <span className="break-all">이메일: <span className="text-white/70">{invitation?.email}</span></span>
          <span>역할: <span className="text-white/70">{roleLabels[invitation?.role ?? ''] ?? invitation?.role}</span></span>
          {(invitation?.organizationName || invitation?.organization?.name) && <span>소속 사업자: <span className="text-white/70">{invitation.organizationName || invitation.organization?.name}</span></span>}
          {!!invitation?.propertyNames?.length && <span>담당 지점: <span className="text-white/70">{invitation.propertyNames.join(' · ')}</span></span>}
          {invitation?.expiresAt && <span>유효기한: {new Date(invitation.expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>}
        </div>

        {user && !matchingUser ? <div className="space-y-4"><p className="break-all text-sm leading-relaxed text-white/60">현재 {user.email} 계정으로 로그인되어 있습니다. 초대받은 이메일 계정으로 로그인한 뒤 수락해 주세요.</p><button type="button" disabled={isSubmitting} onClick={() => void switchAccount()} className="min-h-11 w-full border border-white/30 px-4 py-3 text-sm text-white disabled:opacity-50">{isSubmitting ? '이동 중…' : '초대받은 계정으로 로그인'}</button>{error && <p role="alert" className="text-red-400 text-xs">{error}</p>}</div> : <form onSubmit={handleAccept} className="space-y-4">
          {matchingUser ? <p className="text-sm leading-relaxed text-white/60">위 소속 사업자와 역할을 확인한 뒤 초대를 수락해 주세요. 수락 완료 후 운영 화면으로 이동합니다.</p> : <><p className="text-xs leading-relaxed text-white/50">새 계정은 사용할 비밀번호를 정해 주세요. 이미 계정이 있다면 기존 비밀번호로 로그인한 뒤 초대를 수락합니다.</p><div>
            <label className="block text-[12px] uppercase tracking-widest text-white/40 mb-2">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              disabled={isSubmitting}
              minLength={6}
              className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              placeholder="6자 이상"
            />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-widest text-white/40 mb-2">비밀번호 확인</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              disabled={isSubmitting}
              className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              placeholder="••••••••"
            />
          </div></>}

          {error && <p role="alert" className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-white text-black py-4 text-[13px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 mt-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                처리 중...
              </>
            ) : (
              matchingUser ? '초대 수락' : '가입 또는 로그인 후 초대 수락'
            )}
          </button>
        </form>}
      </div>
    </div>
  );
}
