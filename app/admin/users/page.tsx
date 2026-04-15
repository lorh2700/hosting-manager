'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Save, UserCog, UserPlus, Copy, Check, Ban, ShieldCheck } from 'lucide-react';
import type { UserRole, UserStatus } from '@/lib/types';

interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  propertyIds: string[];
  lastLoginAt?: string;
  createdAt?: string;
}

interface InvitationRecord {
  id: string;
  email: string;
  role: UserRole;
  status: 'pending' | 'accepted' | 'expired';
  createdAt: string;
  expiresAt: string;
  token: string;
}

interface Property {
  id: string;
  name: string;
}

import { ROLE_LABELS, USER_STATUS_LABELS as STATUS_LABELS } from '@/lib/constants';

export default function UsersPage() {
  const { user, profile } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Invite form
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('host');
  const [invitePropertyIds, setInvitePropertyIds] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.role !== 'super_admin' && profile?.role !== 'admin') return;
    const load = async () => {
      try {
        const [usersRes, propsRes, invRes] = await Promise.all([
          fetch('/api/users'),
          fetch('/api/properties'),
          fetch('/api/invitations'),
        ]);
        if (!usersRes.ok || !propsRes.ok || !invRes.ok) throw new Error('Failed to fetch data');

        const usersData = await usersRes.json();
        const propsData = await propsRes.json();
        const invData = await invRes.json();

        setUsers((usersData as any[]).map(d => ({
          id: d.id,
          email: d.email ?? '',
          displayName: d.displayName ?? '',
          role: (d.role as UserRole) ?? 'host',
          status: (d.status as UserStatus) ?? 'active',
          propertyIds: (d.propertyIds as string[]) ?? [],
          lastLoginAt: d.lastLoginAt,
          createdAt: d.createdAt,
        })));
        setProperties((propsData as any[]).map(d => ({ id: d.id, name: d.name })));
        setInvitations((invData as any[]).map(d => ({
          id: d.id,
          email: d.email ?? '',
          role: (d.role as UserRole) ?? 'host',
          status: d.status ?? 'pending',
          createdAt: d.createdAt ?? '',
          expiresAt: d.expiresAt ?? '',
          token: d.token ?? '',
        })));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile]);

  const updateUser = (id: string, patch: Partial<UserRecord>) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u));
  };

  const toggleProperty = (userId: string, propId: string) => {
    setUsers(prev => prev.map(u => {
      if (u.id !== userId) return u;
      const has = u.propertyIds.includes(propId);
      return { ...u, propertyIds: has ? u.propertyIds.filter(p => p !== propId) : [...u.propertyIds, propId] };
    }));
  };

  const handleSave = async (userRecord: UserRecord) => {
    setSaving(userRecord.id);
    try {
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: userRecord.id,
          role: userRecord.role,
          status: userRecord.status,
          propertyIds: userRecord.propertyIds,
          displayName: userRecord.displayName,
          updatedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error('Failed to save user');
    } catch (err) {
      console.error(err);
      alert('저장에 실패했습니다.');
    } finally {
      setSaving(null);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !inviteEmail) return;
    setInviting(true);

    try {
      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
          propertyIds: invitePropertyIds,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '초대에 실패했습니다.');
        return;
      }

      const data = await res.json();
      setInvitations(prev => [...prev, {
        id: data.id,
        email: data.email,
        role: data.role,
        status: 'pending',
        createdAt: data.createdAt,
        expiresAt: data.expiresAt,
        token: data.token,
      }]);
      setInviteEmail('');
      setInvitePropertyIds([]);
      setShowInviteForm(false);
    } catch (err) {
      console.error(err);
      alert('초대에 실패했습니다.');
    } finally {
      setInviting(false);
    }
  };

  const copyInviteLink = (token: string) => {
    const link = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(link);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const toggleInviteProperty = (propId: string) => {
    setInvitePropertyIds(prev =>
      prev.includes(propId) ? prev.filter(p => p !== propId) : [...prev, propId]
    );
  };

  if (profile?.role !== 'super_admin' && profile?.role !== 'admin') {
    return <div className="text-white/50 p-8">접근 권한이 없습니다.</div>;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  const pendingInvitations = invitations.filter(i => i.status === 'pending');

  return (
    <div className="max-w-4xl mx-auto space-y-8 sm:space-y-12">
      <header className="border-b border-white/10 pb-6 sm:pb-8 flex flex-col sm:flex-row gap-4 sm:justify-between sm:items-end">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-white/50 mb-3 sm:mb-4">설정</p>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-light tracking-tight text-white">유저 관리</h1>
          <p className="text-white/50 mt-2 sm:mt-4 text-sm font-light tracking-wide">
            유저의 역할, 상태 및 숙소 접근 권한을 관리합니다.
          </p>
        </div>
        <button
          onClick={() => setShowInviteForm(!showInviteForm)}
          className="flex items-center justify-center gap-2 bg-white text-black px-6 py-3 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 active:scale-[0.98] transition-all shrink-0"
        >
          <UserPlus size={14} />
          사용자 초대
        </button>
      </header>

      {/* Invite Form */}
      {showInviteForm && (
        <div className="bg-[#111] border border-white/20 p-6">
          <h2 className="text-sm font-medium text-white mb-4">새 사용자 초대</h2>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">이메일</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  required
                  className="w-full bg-black/50 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">역할</label>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as UserRole)}
                  className="w-full bg-black/50 border border-white/10 text-white text-sm px-4 py-2.5 focus:outline-none focus:border-white/30 transition-colors"
                >
                  <option value="admin">관리자</option>
                  <option value="host">호스트</option>
                  <option value="cleaner">청소 담당자</option>
                  <option value="viewer">뷰어</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">접근 가능 숙소</label>
              <div className="flex flex-wrap gap-2">
                {properties.map(prop => {
                  const active = invitePropertyIds.includes(prop.id);
                  return (
                    <button
                      key={prop.id}
                      type="button"
                      onClick={() => toggleInviteProperty(prop.id)}
                      className={`px-3 py-1.5 text-[10px] tracking-widest border transition-colors ${
                        active
                          ? 'border-white/40 bg-white/10 text-white'
                          : 'border-white/10 text-white/40 hover:border-white/20'
                      }`}
                    >
                      {prop.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowInviteForm(false)}
                className="px-4 py-2 text-[10px] tracking-widest text-white/50 hover:text-white transition-colors"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={inviting}
                className="flex items-center gap-2 bg-white text-black px-6 py-2 text-[10px] tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50"
              >
                {inviting ? '초대 중...' : '초대 보내기'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pending Invitations */}
      {pendingInvitations.length > 0 && (
        <div>
          <h2 className="text-[10px] uppercase tracking-widest text-white/50 mb-4">대기중인 초대 ({pendingInvitations.length})</h2>
          <div className="space-y-2">
            {pendingInvitations.map(inv => (
              <div key={inv.id} className="bg-[#111] border border-amber-500/20 p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-white text-sm">{inv.email}</p>
                  <p className="text-white/40 text-xs mt-1">
                    {ROLE_LABELS[inv.role]} &middot; 만료: {new Date(inv.expiresAt).toLocaleDateString('ko-KR')}
                  </p>
                </div>
                <button
                  onClick={() => copyInviteLink(inv.token)}
                  className="flex items-center gap-2 text-[10px] tracking-widest text-white/50 hover:text-white transition-colors px-3 py-1.5 border border-white/10 hover:border-white/30"
                >
                  {copiedToken === inv.token ? <Check size={12} /> : <Copy size={12} />}
                  {copiedToken === inv.token ? '복사됨' : '링크 복사'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* User List */}
      {users.length === 0 ? (
        <div className="bg-[#111] border border-white/10 p-12 text-center flex flex-col items-center text-white/40">
          <UserCog size={32} className="mb-4 opacity-50" />
          <p className="text-sm">등록된 유저가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {users.map(userRecord => (
            <div key={userRecord.id} className="bg-[#111] border border-white/10 p-6 hover:border-white/30 transition-colors">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-white font-medium text-sm">{userRecord.displayName || userRecord.email}</p>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider font-medium ${
                        userRecord.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
                        userRecord.status === 'suspended' ? 'bg-red-500/20 text-red-400' :
                        'bg-amber-500/20 text-amber-400'
                      }`}>
                        {STATUS_LABELS[userRecord.status]}
                      </span>
                    </div>
                    <p className="text-white/40 text-xs mt-1">
                      {userRecord.email}
                      {userRecord.lastLoginAt && (
                        <span className="ml-2">
                          &middot; 마지막 로그인: {new Date(userRecord.lastLoginAt).toLocaleDateString('ko-KR')}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Status Toggle */}
                  {userRecord.status === 'pending_invite' ? (
                    <button
                      onClick={() => updateUser(userRecord.id, { status: 'active' })}
                      className="flex items-center gap-1 text-[10px] tracking-widest text-emerald-400 border border-emerald-500/30 px-3 py-1.5 hover:bg-emerald-500/10 transition-colors"
                      title="승인"
                    >
                      <ShieldCheck size={12} />
                      승인
                    </button>
                  ) : userRecord.status === 'active' ? (
                    <button
                      onClick={() => updateUser(userRecord.id, { status: 'suspended' })}
                      className="flex items-center gap-1 text-[10px] tracking-widest text-red-400/60 border border-red-500/20 px-3 py-1.5 hover:bg-red-500/10 transition-colors"
                      title="비활성화"
                    >
                      <Ban size={12} />
                    </button>
                  ) : (
                    <button
                      onClick={() => updateUser(userRecord.id, { status: 'active' })}
                      className="flex items-center gap-1 text-[10px] tracking-widest text-emerald-400/60 border border-emerald-500/20 px-3 py-1.5 hover:bg-emerald-500/10 transition-colors"
                      title="활성화"
                    >
                      <ShieldCheck size={12} />
                    </button>
                  )}

                  <select
                    value={userRecord.role}
                    onChange={e => updateUser(userRecord.id, { role: e.target.value as UserRole })}
                    className="bg-black/50 border border-white/10 text-white text-[11px] uppercase tracking-widest px-3 py-2 focus:outline-none focus:border-white/30 transition-colors"
                  >
                    <option value="super_admin">{ROLE_LABELS.super_admin}</option>
                    <option value="admin">{ROLE_LABELS.admin}</option>
                    <option value="host">{ROLE_LABELS.host}</option>
                    <option value="cleaner">{ROLE_LABELS.cleaner}</option>
                    <option value="viewer">{ROLE_LABELS.viewer}</option>
                  </select>
                </div>
              </div>

              {userRecord.role !== 'super_admin' && (
                <div className="mb-6">
                  <p className="text-[10px] uppercase tracking-widest text-white/40 mb-3">접근 가능 숙소</p>
                  <div className="flex flex-wrap gap-2">
                    {properties.map(prop => {
                      const active = userRecord.propertyIds.includes(prop.id);
                      return (
                        <button
                          key={prop.id}
                          onClick={() => toggleProperty(userRecord.id, prop.id)}
                          className={`px-3 py-1.5 text-[10px] tracking-widest border transition-colors ${
                            active
                              ? 'border-white/40 bg-white/10 text-white'
                              : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/60'
                          }`}
                        >
                          {prop.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={() => handleSave(userRecord)}
                  disabled={saving === userRecord.id}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white hover:text-black text-white px-4 py-2 text-[10px] tracking-widest font-semibold transition-colors disabled:opacity-50"
                >
                  <Save size={13} />
                  {saving === userRecord.id ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
