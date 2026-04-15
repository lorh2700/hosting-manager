'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Save, Lock } from 'lucide-react';
import { ROLE_LABELS } from '@/lib/constants';

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setSaveMessage('');

    try {
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user.id,
          displayName,
          phone: phone || null,
          updatedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      await refreshProfile();
      setSaveMessage('프로필이 저장되었습니다.');
    } catch (err) {
      console.error(err);
      setSaveMessage('저장에 실패했습니다.');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMessage(''), 3000);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !user.email) return;

    if (newPassword.length < 6) {
      setPasswordMessage('새 비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage('새 비밀번호가 일치하지 않습니다.');
      return;
    }

    setChangingPassword(true);
    setPasswordMessage('');

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to change password');
      }
      setPasswordMessage('비밀번호가 변경되었습니다.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const e = err as { message?: string };
      if (e.message?.includes('wrong-password') || e.message?.includes('invalid-credential')) {
        setPasswordMessage('현재 비밀번호가 올바르지 않습니다.');
      } else {
        setPasswordMessage('비밀번호 변경에 실패했습니다.');
        console.error(err);
      }
    } finally {
      setChangingPassword(false);
      setTimeout(() => setPasswordMessage(''), 5000);
    }
  };

  if (!user || !profile) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-8 sm:space-y-12">
      <header className="border-b border-white/10 pb-6 sm:pb-8">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-3 sm:mb-4">설정</p>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-light tracking-tight text-white">내 프로필</h1>
      </header>

      {/* Profile Info */}
      <form onSubmit={handleSaveProfile} className="bg-[#111] border border-white/10 p-6 space-y-6">
        <h2 className="text-sm font-medium text-white flex items-center gap-2">기본 정보</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">이메일</label>
            <input
              type="email"
              value={user.email ?? ''}
              disabled
              className="w-full bg-black/30 border border-white/5 px-4 py-2.5 text-sm text-white/50 cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">역할</label>
            <input
              type="text"
              value={ROLE_LABELS[profile.role] ?? profile.role}
              disabled
              className="w-full bg-black/30 border border-white/5 px-4 py-2.5 text-sm text-white/50 cursor-not-allowed"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">이름</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="w-full bg-black/50 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              placeholder="표시 이름"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">연락처</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="w-full bg-black/50 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              placeholder="010-0000-0000"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          {saveMessage && (
            <p className={`text-xs ${saveMessage.includes('실패') ? 'text-red-400' : 'text-emerald-400'}`}>
              {saveMessage}
            </p>
          )}
          <div className="ml-auto">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-white text-black px-6 py-2.5 text-[10px] tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50"
            >
              <Save size={13} />
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </form>

      {/* Password Change */}
      <form onSubmit={handleChangePassword} className="bg-[#111] border border-white/10 p-6 space-y-6">
        <h2 className="text-sm font-medium text-white flex items-center gap-2">
          <Lock size={14} />
          비밀번호 변경
        </h2>

        <div>
          <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">현재 비밀번호</label>
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            required
            className="w-full bg-black/50 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">새 비밀번호</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              minLength={6}
              className="w-full bg-black/50 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              placeholder="6자 이상"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">새 비밀번호 확인</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              className="w-full bg-black/50 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          {passwordMessage && (
            <p className={`text-xs ${passwordMessage.includes('실패') || passwordMessage.includes('올바르지') || passwordMessage.includes('이상') || passwordMessage.includes('일치') ? 'text-red-400' : 'text-emerald-400'}`}>
              {passwordMessage}
            </p>
          )}
          <div className="ml-auto">
            <button
              type="submit"
              disabled={changingPassword}
              className="flex items-center gap-2 bg-white/10 hover:bg-white hover:text-black text-white px-6 py-2.5 text-[10px] tracking-widest font-semibold transition-colors disabled:opacity-50"
            >
              <Lock size={13} />
              {changingPassword ? '변경 중...' : '비밀번호 변경'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
