'use client';

import { useState } from 'react';

type Mode = 'email' | 'phone' | 'register';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('email');
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
  const subtitle: Record<Mode, string> = {
    email: 'void anchae 숙소를 관리하려면 로그인하세요.',
    phone: '전화번호와 초기 비밀번호(전화번호 뒷 4자리)로 로그인하세요.',
    register: '새 계정을 만들어 시작하세요.',
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505] p-4 font-sans">
      <div className="bg-[#111] p-10 border border-white/10 max-w-md w-full">
        <h1 className="text-2xl font-light tracking-widest text-white mb-2 uppercase">
          {tabLabel[mode]}
        </h1>
        <p className="text-white/50 mb-6 text-sm font-light tracking-wide">
          {subtitle[mode]}
        </p>

        {mode !== 'register' && (
          <div className="flex gap-2 mb-6 border-b border-white/10">
            <button
              type="button"
              onClick={() => { setMode('email'); resetFields(); }}
              className={`pb-3 px-3 text-[11px] uppercase tracking-widest transition-colors ${
                mode === 'email' ? 'text-white border-b border-white' : 'text-white/40 hover:text-white/70'
              }`}
            >
              이메일
            </button>
            <button
              type="button"
              onClick={() => { setMode('phone'); resetFields(); }}
              className={`pb-3 px-3 text-[11px] uppercase tracking-widest transition-colors ${
                mode === 'phone' ? 'text-white border-b border-white' : 'text-white/40 hover:text-white/70'
              }`}
            >
              전화번호
            </button>
          </div>
        )}

        <form
          onSubmit={mode === 'email' ? handleEmailLogin : mode === 'phone' ? handlePhoneLogin : handleRegister}
          className="space-y-4"
        >
          {mode === 'phone' ? (
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">전화번호</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                required
                autoComplete="tel"
                inputMode="numeric"
                className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
                placeholder="010-0000-0000"
              />
            </div>
          ) : (
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
          )}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">
              {mode === 'phone' ? '비밀번호 (전화번호 뒷 4자리)' : '비밀번호'}
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              inputMode={mode === 'phone' ? 'numeric' : undefined}
              className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              placeholder={mode === 'phone' ? '••••' : '••••••••'}
            />
          </div>
          {mode === 'register' && (
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">비밀번호 확인</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-white text-black py-4 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 mt-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
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
          className="w-full mt-4 text-center text-xs text-white/30 hover:text-white/60 transition-colors tracking-wide"
        >
          {mode === 'register' ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입'}
        </button>
      </div>
    </div>
  );
}
