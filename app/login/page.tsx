'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Home, Compass } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { writeAdminMode, type AdminMode } from '@/lib/adminMode';

type Mode = 'email' | 'phone' | 'register';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('email');
  const [adminMode, setAdminMode] = useState<AdminMode>('host');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const resetFields = () => {
    setEmail('');
    setPhone('');
    setPassword('');
    setConfirmPassword('');
    setError('');
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
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
        // Persist chosen admin area so /admin sidebar/dashboard pick it up.
        writeAdminMode(adminMode);
        window.location.href = '/admin';
      }
    } catch {
      setError('로그인에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhoneLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '로그인에 실패했습니다.');
      } else {
        window.location.href = '/cleaner';
      }
    } catch {
      setError('로그인에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }
    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '회원가입에 실패했습니다.');
      } else {
        const loginRes = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (loginRes.ok) {
          writeAdminMode(adminMode);
          window.location.href = '/admin';
        } else {
          setMode('email');
          setError('가입 완료! 로그인해 주세요.');
        }
      }
    } catch {
      setError('회원가입에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const tabLabel: Record<Mode, string> = {
    email: '호스트 로그인',
    phone: '청소 담당자 로그인',
    register: '회원가입',
  };
  const eyebrow: Record<Mode, string> = {
    email: 'Host',
    phone: 'Cleaner',
    register: 'Register',
  };
  const subtitle: Record<Mode, string> = {
    email: 'void anchae 숙소를 관리하려면 로그인하세요.',
    phone: '전화번호와 초기 비밀번호(전화번호 뒷 4자리)로 로그인하세요.',
    register: '새 계정을 만들어 시작하세요.',
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 p-5 font-sans">
      <Link
        href="/"
        aria-label="void anchae 홈으로"
        className="mb-9 inline-flex hover:opacity-80 transition-opacity"
      >
        <Logo width={200} variant="black" priority />
      </Link>

      <div className="bg-white p-8 sm:p-10 border border-stone-200 max-w-md w-full">
        <p className="text-[10px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">
          {eyebrow[mode]}
        </p>
        <h1 className="text-xl font-semibold text-stone-900 mb-1.5">
          {tabLabel[mode]}
        </h1>
        <p className="text-stone-500 mb-6 text-sm">
          {subtitle[mode]}
        </p>

        {mode !== 'register' && (
          <div className="flex gap-2 mb-6 border-b border-stone-200">
            <button
              type="button"
              onClick={() => { setMode('email'); resetFields(); }}
              className={`pb-3 px-3 text-[11px] uppercase tracking-widest transition-colors ${
                mode === 'email' ? 'text-stone-900 border-b-2 border-[var(--brand)] font-semibold' : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              이메일
            </button>
            <button
              type="button"
              onClick={() => { setMode('phone'); resetFields(); }}
              className={`pb-3 px-3 text-[11px] uppercase tracking-widest transition-colors ${
                mode === 'phone' ? 'text-stone-900 border-b-2 border-[var(--brand)] font-semibold' : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              전화번호
            </button>
          </div>
        )}

        {/* Admin area toggle — only relevant for email login (host vs tour operator) */}
        {(mode === 'email' || mode === 'register') && (
          <div className="mb-5">
            <label className="block text-[10px] uppercase tracking-widest text-stone-600 mb-2">관리 영역</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAdminMode('host')}
                aria-pressed={adminMode === 'host'}
                className={`flex items-center justify-center gap-2 py-3 border transition-all ${
                  adminMode === 'host'
                    ? 'bg-[var(--brand-tint)] border-[var(--brand)] text-[var(--brand-dark)]'
                    : 'bg-white border-stone-300 text-stone-600 hover:border-stone-400'
                }`}
              >
                <Home size={14} strokeWidth={1.8} className={adminMode === 'host' ? 'text-[var(--brand)]' : 'text-stone-400'} />
                <span className="text-xs font-semibold tracking-widest uppercase">숙박 호스트</span>
              </button>
              <button
                type="button"
                onClick={() => setAdminMode('tour')}
                aria-pressed={adminMode === 'tour'}
                className={`flex items-center justify-center gap-2 py-3 border transition-all ${
                  adminMode === 'tour'
                    ? 'bg-[var(--brand-tint)] border-[var(--brand)] text-[var(--brand-dark)]'
                    : 'bg-white border-stone-300 text-stone-600 hover:border-stone-400'
                }`}
              >
                <Compass size={14} strokeWidth={1.8} className={adminMode === 'tour' ? 'text-[var(--brand)]' : 'text-stone-400'} />
                <span className="text-xs font-semibold tracking-widest uppercase">투어 운영자</span>
              </button>
            </div>
          </div>
        )}

        <form
          onSubmit={mode === 'email' ? handleEmailLogin : mode === 'phone' ? handlePhoneLogin : handleRegister}
          className="space-y-4"
        >
          {mode === 'phone' ? (
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-600 mb-2">전화번호</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                required
                autoComplete="tel"
                inputMode="numeric"
                className="w-full bg-white border border-stone-300 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                placeholder="010-0000-0000"
              />
            </div>
          ) : (
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-600 mb-2">이메일</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full bg-white border border-stone-300 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                placeholder="example@email.com"
              />
            </div>
          )}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-600 mb-2">
              {mode === 'phone' ? '비밀번호 (전화번호 뒷 4자리)' : '비밀번호'}
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              inputMode={mode === 'phone' ? 'numeric' : undefined}
              className="w-full bg-white border border-stone-300 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
              placeholder={mode === 'phone' ? '••••' : '••••••••'}
            />
          </div>
          {mode === 'register' && (
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-600 mb-2">비밀번호 확인</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full bg-white border border-stone-300 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && <p className="text-rose-600 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white py-3.5 text-sm font-semibold uppercase tracking-widest transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                {mode === 'register' ? '가입 중...' : '로그인 중...'}
              </>
            ) : (
              mode === 'register' ? '회원가입' : '로그인'
            )}
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === 'register' ? 'email' : 'register');
            resetFields();
          }}
          className="w-full mt-4 text-center text-xs text-stone-500 hover:text-stone-900 transition-colors tracking-wide"
        >
          {mode === 'register' ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입'}
        </button>
      </div>
    </div>
  );
}
