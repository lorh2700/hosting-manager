'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { UserPlus, Copy, Check, ShieldCheck, Clock, XCircle } from 'lucide-react';
import type { UserRole, UserStatus } from '@/lib/types';
import { ROLE_LABELS, ROLE_DESCRIPTIONS, STAFF_ROLES, USER_STATUS_LABELS as STATUS_LABELS } from '@/lib/constants';
import { toast, confirmDialog, SkeletonList } from '@/components/ui';
import CreateUserForm, { type CreateUserSeed, type CreatedUser } from '../users/CreateUserForm';

/**
 * 유저 관리 — 관리자·매니저 계정만 다룬다.
 *  1. 승인 대기: 공개 가입한 계정. 역할·숙소를 정해 승인하거나 거절(삭제)한다.
 *  2. 관리자·매니저: 역할, 상태, 매니저의 배정 숙소.
 *  3. 초대: 이메일 초대 링크 (관리자/매니저). 청소담당자는 청소 담당자 관리에서.
 */

interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  phone?: string | null;
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
  propertyIds: string[];
}

interface Property {
  id: string;
  name: string;
}

type RawUser = Partial<UserRecord> & { id: string };
type RawInvitation = Partial<InvitationRecord> & { id: string };

const inputCls = 'w-full bg-white border border-stone-200 px-4 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors';
const selectCls = 'bg-white border border-stone-200 text-stone-900 text-[13px] uppercase tracking-widest px-3 py-2 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors';

function PropertyToggles({ properties, selected, onToggle, disabled }: {
  properties: Property[]; selected: string[]; onToggle: (id: string) => void; disabled?: boolean;
}) {
  if (properties.length === 0) return <p className="text-xs text-stone-400">등록된 숙소가 없습니다.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {properties.map(prop => {
        const active = selected.includes(prop.id);
        return (
          <button
            key={prop.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(prop.id)}
            className={`px-3 py-1.5 text-[12px] tracking-widest border transition-colors disabled:opacity-50 ${
              active
                ? 'border-[var(--brand)]/40 bg-[var(--brand-tint)] text-[var(--brand-dark)]'
                : 'border-stone-200 text-stone-500 hover:border-stone-300 hover:text-stone-700'
            }`}
          >
            {prop.name}
          </button>
        );
      })}
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: UserRole; onChange: (r: UserRole) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as UserRole)} className={selectCls}>
      {STAFF_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
    </select>
  );
}

export default function InvitationsPanel({ onChanged }: { onChanged?: () => void }) {
  const { user, profile } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [createSeed, setCreateSeed] = useState<CreateUserSeed | null>(null);
  const [createFormKey, setCreateFormKey] = useState(0);

  // Invite form
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('manager');
  const [invitePropertyIds, setInvitePropertyIds] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';

  const load = useCallback(async () => {
    try {
      const [usersRes, propsRes, invRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/properties'),
        fetch('/api/invitations'),
      ]);
      if (!usersRes.ok || !propsRes.ok || !invRes.ok) throw new Error('Failed to fetch data');

      const usersData: RawUser[] = await usersRes.json();
      const propsData: Property[] = await propsRes.json();
      const invData: RawInvitation[] = await invRes.json();

      setUsers(usersData.map(d => ({
        id: d.id,
        email: d.email ?? '',
        displayName: d.displayName ?? '',
        phone: d.phone ?? null,
        role: d.role ?? 'manager',
        status: d.status ?? 'active',
        propertyIds: d.propertyIds ?? [],
        lastLoginAt: d.lastLoginAt,
        createdAt: d.createdAt,
      })));
      setProperties(propsData.map(d => ({ id: d.id, name: d.name })));
      setInvitations(invData.map(d => ({
        id: d.id,
        email: d.email ?? '',
        role: d.role ?? 'manager',
        status: d.status ?? 'pending',
        createdAt: d.createdAt ?? '',
        expiresAt: d.expiresAt ?? '',
        token: d.token ?? '',
        propertyIds: d.propertyIds ?? [],
      })));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    load();
  }, [isAdmin, load]);

  const updateLocal = (id: string, patch: Partial<UserRecord>) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u));
  };

  const toggleProperty = (userId: string, propId: string) => {
    setUsers(prev => prev.map(u => {
      if (u.id !== userId) return u;
      const has = u.propertyIds.includes(propId);
      return { ...u, propertyIds: has ? u.propertyIds.filter(p => p !== propId) : [...u.propertyIds, propId] };
    }));
  };

  /** 서버 저장. patch 가 있으면 화면 값 위에 덮어서 보낸다 (승인·정지처럼 즉시 반영되는 동작). */
  const saveUser = async (record: UserRecord, patch: Partial<UserRecord> = {}): Promise<boolean> => {
    const next = { ...record, ...patch };
    setBusy(record.id);
    try {
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: next.id,
          role: next.role,
          status: next.status,
          propertyIds: next.role === 'manager' ? next.propertyIds : undefined,
          displayName: next.displayName,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || '저장에 실패했습니다.');
        return false;
      }
      updateLocal(record.id, patch);
      onChanged?.();
      return true;
    } catch (err) {
      console.error(err);
      toast.error('저장에 실패했습니다.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (record: UserRecord, verb = '삭제') => {
    if (record.id === user?.id) {
      toast.error('자기 자신은 삭제할 수 없습니다.');
      return;
    }
    const label = record.displayName || record.email;
    if (!(await confirmDialog(`${label} 계정을 ${verb}하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`))) return;
    setBusy(record.id);
    try {
      const res = await fetch(`/api/users/${record.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `${verb}에 실패했습니다.`);
        return;
      }
      setUsers(prev => prev.filter(u => u.id !== record.id));
    } catch (err) {
      console.error(err);
      toast.error(`${verb}에 실패했습니다.`);
    } finally {
      setBusy(null);
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
          propertyIds: inviteRole === 'manager' ? invitePropertyIds : [],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || '초대에 실패했습니다.');
        return;
      }
      setInvitations(prev => [...prev, {
        id: data.id,
        email: data.email,
        role: data.role,
        status: 'pending',
        createdAt: data.createdAt,
        expiresAt: data.expiresAt,
        token: data.token,
        propertyIds: data.propertyIds ?? [],
      }]);
      setInviteEmail('');
      setInvitePropertyIds([]);
      setShowInviteForm(false);
    } catch (err) {
      console.error(err);
      toast.error('초대에 실패했습니다.');
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
    setInvitePropertyIds(prev => prev.includes(propId) ? prev.filter(p => p !== propId) : [...prev, propId]);
  };

  const userCreated = (record: CreatedUser) => {
    onChanged?.();
    setUsers(current => [record, ...current]);
    setInvitations(current => current.map(invitation => invitation.email.toLowerCase() === record.email ? { ...invitation, status: 'expired' } : invitation));
    toast.success(`${record.displayName} 계정을 등록했습니다. 바로 로그인할 수 있습니다.`);
  };

  if (!isAdmin) {
    return <div className="text-stone-500 p-8">접근 권한이 없습니다.</div>;
  }

  if (loading) {
    return <SkeletonList count={3} rows={2} />;
  }

  const pendingInvitations = invitations.filter(i => i.status === 'pending');
  const pendingUsers = users.filter(u => u.status === 'pending_invite');


  return (
    <div className="max-w-4xl mx-auto space-y-8 sm:space-y-12">
      <header className="border-b border-stone-200 pb-6 sm:pb-8 flex flex-col sm:flex-row gap-4 sm:justify-between sm:items-end">
        <div>
          <p className="text-[12px] tracking-[0.3em] text-stone-500 mb-3 sm:mb-4">설정</p>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-light tracking-tight text-stone-900">초대·가입 승인</h1>
          <p className="text-stone-500 mt-2 sm:mt-4 text-sm font-light tracking-wide">
            대기 중인 초대와 가입 신청을 관리합니다. 직원 정보 수정은 통합 목록에서 진행하세요.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
        <button
          onClick={() => setShowInviteForm(!showInviteForm)}
          className="flex items-center justify-center gap-2 border border-stone-300 text-stone-600 px-5 py-3 text-[13px] font-semibold hover:bg-stone-50"
        >
          <UserPlus size={14} />
          사용자 초대
        </button>
        </div>
      </header>

      {/* 역할 안내 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(['admin', 'manager', 'cleaner'] as UserRole[]).map(r => (
          <div key={r} className="bg-white border border-stone-200 px-4 py-3">
            <p className="text-[13px] uppercase tracking-widest text-stone-900 font-medium">{ROLE_LABELS[r]}</p>
            <p className="text-xs text-stone-500 mt-1 leading-relaxed">{ROLE_DESCRIPTIONS[r]}</p>
          </div>
        ))}
      </div>

      {createSeed && <CreateUserForm key={createFormKey} initial={createSeed} properties={properties} onCreated={userCreated} onClose={() => setCreateSeed(null)} />}

      {/* Invite Form */}
      {showInviteForm && (
        <div className="bg-white border border-stone-300 p-6">
          <h2 className="text-sm font-medium text-stone-900 mb-4">새 사용자 초대</h2>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">이메일</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  required
                  className={inputCls}
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">역할</label>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as UserRole)}
                  className="w-full bg-white border border-stone-200 text-stone-900 text-sm px-4 py-2.5 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                >
                  {STAFF_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
                <p className="text-[12px] text-stone-400 mt-1.5">{ROLE_DESCRIPTIONS[inviteRole]}</p>
              </div>
            </div>

            {inviteRole === 'manager' && (
              <div>
                <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">배정 숙소</label>
                <PropertyToggles properties={properties} selected={invitePropertyIds} onToggle={toggleInviteProperty} />
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowInviteForm(false)}
                className="px-4 py-2 text-[12px] tracking-widest text-stone-500 hover:text-stone-900 transition-colors"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={inviting}
                className="flex items-center gap-2 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white px-6 py-2 text-[12px] tracking-widest font-semibold uppercase transition-colors disabled:opacity-50"
              >
                {inviting ? '초대 중...' : '초대 링크 만들기'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pending Invitations */}
      {pendingInvitations.length > 0 && (
        <div>
          <h2 className="text-[12px] uppercase tracking-widest text-stone-500 mb-4">대기중인 초대 ({pendingInvitations.length})</h2>
          <div className="space-y-2">
            {pendingInvitations.map(inv => (
              <div key={inv.id} className="bg-white border border-amber-200 p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-stone-900 text-sm">{inv.email}</p>
                  <p className="text-stone-500 text-xs mt-1">
                    {ROLE_LABELS[inv.role] ?? inv.role} &middot; 만료: {new Date(inv.expiresAt).toLocaleDateString('ko-KR')}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                {inv.role !== 'cleaner' && <button type="button" onClick={() => { setCreateFormKey(key => key + 1); setCreateSeed({ email: inv.email, role: inv.role === 'admin' ? 'admin' : 'manager', propertyIds: inv.propertyIds }); setShowInviteForm(false); }} className="px-3 py-1.5 text-xs border border-[var(--brand)] text-[var(--brand-dark)] hover:bg-[var(--brand-tint)]">바로 등록</button>}
                <button
                  onClick={() => copyInviteLink(inv.token)}
                  className="flex items-center gap-2 text-[12px] tracking-widest text-stone-500 hover:text-stone-900 transition-colors px-3 py-1.5 border border-stone-200 hover:border-stone-300"
                >
                  {copiedToken === inv.token ? <Check size={12} /> : <Copy size={12} />}
                  {copiedToken === inv.token ? '복사됨' : '링크 복사'}
                </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 승인 대기 */}
      {pendingUsers.length > 0 && (
        <div>
          <h2 className="text-[12px] uppercase tracking-widest text-stone-500 mb-4 flex items-center gap-2">
            <Clock size={12} /> 승인 대기 ({pendingUsers.length})
          </h2>
          <div className="space-y-4">
            {pendingUsers.map(record => (
              <div key={record.id} className="bg-white border border-amber-300 p-6">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <p className="text-stone-900 font-medium text-sm">{record.displayName || record.email}</p>
                    <p className="text-stone-500 text-xs mt-1">
                      {record.email}
                      {record.createdAt && <span className="ml-2">&middot; 가입: {new Date(record.createdAt).toLocaleDateString('ko-KR')}</span>}
                    </p>
                  </div>
                  <RoleSelect value={record.role} onChange={r => updateLocal(record.id, { role: r })} />
                </div>

                {record.role === 'manager' && (
                  <div className="mb-5">
                    <p className="text-[12px] uppercase tracking-widest text-stone-500 mb-3">배정 숙소</p>
                    <PropertyToggles properties={properties} selected={record.propertyIds} onToggle={pid => toggleProperty(record.id, pid)} />
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => handleDelete(record, '거절')}
                    disabled={busy === record.id}
                    className="flex items-center gap-2 text-red-600/80 hover:text-red-600 border border-red-200 hover:border-red-300 px-4 py-2 text-[12px] tracking-widest font-semibold uppercase transition-colors disabled:opacity-50"
                  >
                    <XCircle size={13} /> 거절
                  </button>
                  <button
                    onClick={() => saveUser(record, { status: 'active' })}
                    disabled={busy === record.id}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-[12px] tracking-widest font-semibold uppercase transition-colors disabled:opacity-50"
                  >
                    <ShieldCheck size={13} /> {busy === record.id ? '처리 중...' : `${ROLE_LABELS[record.role]}로 승인`}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
