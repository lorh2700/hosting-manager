'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { UserPlus, Copy, Check, ShieldCheck, Clock, XCircle, RefreshCw } from 'lucide-react';
import type { UserRole, UserStatus } from '@/lib/types';
import { ROLE_LABELS } from '@/lib/constants';
import { toast, confirmDialog, SkeletonList } from '@/components/ui';
import CreateUserForm, { type CreateUserSeed, type CreatedUser } from '../users/CreateUserForm';

interface UserRecord { id: string; email: string; displayName: string; role: UserRole; status: UserStatus; propertyIds: string[]; organizationId: string | null; version: number; createdAt?: string }
interface InvitationRecord { id: string; email: string; role: UserRole; status: 'pending' | 'accepted' | 'expired' | 'revoked'; expiresAt: string; token: string; propertyIds: string[]; organizationId: string | null }
interface Property { id: string; name: string; organizationId?: string | null }
interface Organization { id: string; name: string; status: string }
const inputCls = 'w-full bg-white border border-stone-200 px-4 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors';
const buttonCls = 'min-h-11 border border-stone-200 px-4 py-2 text-sm disabled:opacity-50';

function PropertyToggles({ properties, selected, onToggle, disabled }: { properties: Property[]; selected: string[]; onToggle: (id: string) => void; disabled?: boolean }) {
  if (!properties.length) return <p className="text-xs text-stone-500">선택한 사업자에 등록된 숙소가 없습니다.</p>;
  return <div className="flex flex-wrap gap-2">{properties.map(property => <button key={property.id} type="button" disabled={disabled} aria-pressed={selected.includes(property.id)} onClick={() => onToggle(property.id)} className={`${buttonCls} ${selected.includes(property.id) ? 'border-[var(--brand)] bg-[var(--brand-tint)] text-[var(--brand-dark)]' : 'text-stone-500'}`}>{property.name}</button>)}</div>;
}

export default function InvitationsPanel({ onChanged }: { onChanged?: () => void }) {
  const { user, profile } = useAuth();
  const isSuper = profile?.role === 'super_admin';
  const allowed = isSuper || profile?.role === 'admin';
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState(''), [organizationId, setOrganizationId] = useState('');
  const [invitePropertyIds, setInvitePropertyIds] = useState<string[]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [createSeed, setCreateSeed] = useState<CreateUserSeed | null>(null), [createFormKey, setCreateFormKey] = useState(0);
  const targetOrganizationId = isSuper ? organizationId : profile?.organizationId;
  const scopedProperties = (id: string | null | undefined) => properties.filter(item => (item.organizationId || null) === (id || null));

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const responses = await Promise.all([fetch('/api/users'), fetch('/api/properties'), fetch('/api/invitations'), fetch('/api/admin/organizations?picker=1')]);
      if (responses.some(response => !response.ok)) throw new Error('초대·가입 목록을 불러오지 못했습니다.');
      const [usersData, propertiesData, invitationsData, organizationsData] = await Promise.all(responses.map(response => response.json()));
      setUsers(usersData); setProperties(propertiesData); setInvitations(invitationsData); setOrganizations(organizationsData.organizations);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '초대 목록을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);
  const updateLocal = (id: string, patch: Partial<UserRecord>) => setUsers(current => current.map(item => item.id === id ? { ...item, ...patch } : item));

  async function approve(record: UserRecord) {
    if (isSuper && !record.organizationId) { toast.error('소속 사업자를 먼저 선택해 주세요.'); return; }
    if (!isSuper && record.role !== 'manager') { toast.error('사업자 관리자 권한은 슈퍼매니저가 관리합니다.'); return; }
    setBusy(record.id);
    try {
      const response = await fetch(`/api/admin/user-access/${record.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: record.version, role: record.role, status: 'active', propertyIds: record.role === 'manager' ? record.propertyIds : [], ...(isSuper ? { organizationId: record.organizationId } : {}) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '가입을 승인하지 못했습니다.');
      updateLocal(record.id, { status: 'active', version: data.user.version }); onChanged?.(); toast.success('가입을 승인했습니다.');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '가입을 승인하지 못했습니다.'); }
    finally { setBusy(null); }
  }
  async function reject(record: UserRecord) {
    if (record.id === user?.id) return;
    if (!await confirmDialog(`${record.displayName || record.email} 계정의 가입을 거절하시겠습니까?\n계정은 삭제되며 되돌릴 수 없습니다.`)) return;
    setBusy(record.id);
    try { const response = await fetch(`/api/users/${record.id}`, { method: 'DELETE' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || '거절하지 못했습니다.'); setUsers(current => current.filter(item => item.id !== record.id)); onChanged?.(); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : '거절하지 못했습니다.'); }
    finally { setBusy(null); }
  }
  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (isSuper && !organizationId) { toast.error('소속 사업자를 선택해 주세요.'); return; }
    setBusy('invite');
    try {
      const response = await fetch('/api/invitations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: inviteEmail, role: 'manager', propertyIds: invitePropertyIds, ...(isSuper ? { organizationId } : {}) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '초대 링크를 만들지 못했습니다.');
      setInvitations(current => [...current, data]); setInviteEmail(''); setInvitePropertyIds([]); setShowInviteForm(false); onChanged?.();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '초대 링크를 만들지 못했습니다.'); }
    finally { setBusy(null); }
  }
  async function copyLink(token: string) {
    try { await navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`); setCopiedToken(token); setTimeout(() => setCopiedToken(null), 2000); }
    catch { toast.error('링크를 복사하지 못했습니다.'); }
  }
  async function renewInvitation(record: InvitationRecord) {
    if (!await confirmDialog(`${record.email}님의 초대 링크를 다시 발급할까요?\n유효기간은 지금부터 7일이며 이전 링크는 사용할 수 없게 됩니다.`)) return;
    setBusy(record.id);
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(record.token)}/renew`, { method: 'POST' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '초대 링크를 재발급하지 못했습니다.');
      setInvitations(current => current.map(item => item.id === record.id ? data.invitation : item)); setCopiedToken(null); onChanged?.(); toast.success('새 초대 링크를 발급했습니다. 링크를 다시 전달해 주세요.');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '초대 링크를 재발급하지 못했습니다.'); }
    finally { setBusy(null); }
  }
  async function revokeInvitation(record: InvitationRecord) {
    if (!await confirmDialog(`${record.email}님의 초대 링크를 회수할까요?\n이 링크로 가입하거나 권한을 변경할 수 없게 됩니다.`)) return;
    setBusy(record.id);
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(record.token)}`, { method: 'DELETE' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '초대를 회수하지 못했습니다.');
      setInvitations(current => current.map(item => item.id === record.id ? { ...item, status: 'revoked' } : item)); onChanged?.(); toast.success('초대 링크를 회수했습니다.');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '초대를 회수하지 못했습니다.'); }
    finally { setBusy(null); }
  }
  function userCreated(record: CreatedUser) { onChanged?.(); void load(); toast.success(`${record.displayName} 계정을 등록했습니다.`); }
  if (!allowed) return <p className="p-6 text-sm text-stone-500">관리자 권한이 필요합니다.</p>;
  if (loading && !users.length && !invitations.length && !properties.length) return <SkeletonList count={3} rows={2} />;
  const pendingUsers = users.filter(item => item.status === 'pending_invite' && (isSuper || item.role === 'manager'));
  const pendingInvitations = invitations.filter(item => item.status === 'pending' && new Date(item.expiresAt).getTime() > Date.now());
  const reusableInvitations = invitations.filter(item => item.status === 'expired' || item.status === 'revoked' || item.status === 'pending' && new Date(item.expiresAt).getTime() <= Date.now());
  const mayManageInvitation = (item: InvitationRecord) => isSuper || item.organizationId === profile?.organizationId && ['manager', 'cleaner'].includes(item.role);

  return <section className="space-y-6" aria-label="초대·가입 승인">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-5"><div><h2 className="text-2xl font-light">초대·가입 승인</h2><p className="mt-2 text-sm text-stone-500">매니저를 초대하고 소속 사업자와 담당 숙소를 지정해 가입을 승인합니다.</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={loading || !!busy} onClick={() => void load()} className={buttonCls}><RefreshCw size={14} className="mr-2 inline" />{loading ? '불러오는 중…' : '새로고침'}</button><button type="button" onClick={() => setShowInviteForm(value => !value)} className={buttonCls}><UserPlus size={14} className="mr-2 inline" />매니저 초대</button></div></header>
    <p className="text-sm text-stone-500">사업자 관리자 초대와 역할·메뉴 권한은 <Link href="/admin/settings" className="underline">사업자·권한 설정</Link>에서 관리합니다. 청소 인력 초대는 직원 상세 화면을 이용해 주세요.</p>
    {error && <div role="alert" className="border border-red-200 p-4 text-sm text-red-600">{error}<button type="button" onClick={() => void load()} className="ml-3 underline">다시 불러오기</button></div>}
    {createSeed && <CreateUserForm key={createFormKey} initial={createSeed} properties={properties} onCreated={userCreated} onClose={() => setCreateSeed(null)} />}
    {showInviteForm && <form onSubmit={invite} className="space-y-4 border bg-white p-5"><h3 className="font-medium">매니저 초대 링크</h3><label className="block text-xs text-stone-600">이메일<input type="email" required maxLength={200} value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} className={`mt-2 ${inputCls}`} placeholder="manager@example.com" /></label>
      {isSuper ? <label className="block text-xs text-stone-600">소속 사업자<select required value={organizationId} onChange={event => { setOrganizationId(event.target.value); setInvitePropertyIds([]); }} className={`mt-2 ${inputCls}`}><option value="">사업자를 선택해 주세요</option>{organizations.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <p className="text-sm">소속 사업자: {profile?.organizationName || '현재 사업자'}</p>}
      <fieldset><legend className="mb-2 text-xs text-stone-600">배정 숙소</legend><PropertyToggles properties={scopedProperties(targetOrganizationId)} selected={invitePropertyIds} disabled={isSuper && !organizationId} onToggle={id => setInvitePropertyIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])} /></fieldset>
      <p className="text-xs text-stone-500">이메일은 자동 발송되지 않습니다. 생성된 초대 링크를 담당자에게 전달해 주세요.</p><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowInviteForm(false)} className={buttonCls}>취소</button><button type="submit" disabled={busy === 'invite' || (isSuper && !organizationId)} className={`${buttonCls} bg-[var(--brand)] text-white`}>{busy === 'invite' ? '생성 중…' : '초대 링크 만들기'}</button></div>
    </form>}
    <div><h3 className="mb-3 text-sm font-medium">사용 가능한 초대 · {pendingInvitations.length}건</h3><div className="space-y-2">{pendingInvitations.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-white p-4"><div className="min-w-0"><p className="break-all text-sm">{item.email}</p><p className="mt-1 text-xs text-stone-500">{ROLE_LABELS[item.role]} · {organizations.find(org => org.id === item.organizationId)?.name || '소속 미설정'}</p><p className="mt-1 text-xs text-stone-500">유효기한: {new Date(item.expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p></div><div className="flex flex-wrap gap-2">{item.role === 'manager' && <button type="button" disabled={!!busy} onClick={() => { setCreateFormKey(value => value + 1); setCreateSeed({ email: item.email, role: 'manager', propertyIds: item.propertyIds || [], organizationId: item.organizationId }); setShowInviteForm(false); }} className={buttonCls}>바로 등록</button>}<button type="button" disabled={!!busy} onClick={() => void copyLink(item.token)} className={buttonCls}>{copiedToken === item.token ? <Check size={12} className="mr-2 inline" /> : <Copy size={12} className="mr-2 inline" />}{copiedToken === item.token ? '복사됨' : '링크 복사'}</button>{mayManageInvitation(item) && <><button type="button" disabled={!!busy} onClick={() => void renewInvitation(item)} className={buttonCls}>7일 재발급</button><button type="button" disabled={!!busy} onClick={() => void revokeInvitation(item)} className={`${buttonCls} text-red-600`}>초대 회수</button></>}</div></article>)}</div>{!pendingInvitations.length && <p className="text-sm text-stone-500">사용 가능한 초대가 없습니다.</p>}</div>
    {reusableInvitations.length > 0 && <details className="border p-4"><summary className="cursor-pointer text-sm font-medium">만료·회수된 초대 · {reusableInvitations.length}건</summary><div className="mt-3 space-y-2">{reusableInvitations.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 border bg-stone-50 p-4"><div className="min-w-0"><p className="break-all text-sm">{item.email}</p><p className="mt-1 text-xs text-stone-500">{ROLE_LABELS[item.role]} · {item.status === 'revoked' ? '회수됨' : '유효기간 만료'} · 기존 링크 사용 불가</p></div>{mayManageInvitation(item) && <button type="button" disabled={!!busy} onClick={() => void renewInvitation(item)} className={buttonCls}>새 초대 링크 발급</button>}</article>)}</div></details>}
    <div><h3 className="mb-3 text-sm font-medium"><Clock size={13} className="mr-2 inline" />가입 승인 대기 · {pendingUsers.length}건</h3><div className="space-y-3">{pendingUsers.map(record => <article key={record.id} className="space-y-4 border border-amber-200 bg-white p-5"><div><p className="font-medium">{record.displayName || record.email}</p><p className="mt-1 text-xs text-stone-500">{record.email} · {ROLE_LABELS[record.role]}</p></div>
      {isSuper && <label className="block text-xs text-stone-600">소속 사업자<select value={record.organizationId || ''} onChange={event => updateLocal(record.id, { organizationId: event.target.value, propertyIds: [] })} className={`mt-2 ${inputCls}`}><option value="">사업자를 선택해 주세요</option>{organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {record.role === 'manager' && <PropertyToggles properties={scopedProperties(record.organizationId)} selected={record.propertyIds} disabled={busy === record.id || (isSuper && !record.organizationId)} onToggle={id => updateLocal(record.id, { propertyIds: record.propertyIds.includes(id) ? record.propertyIds.filter(value => value !== id) : [...record.propertyIds, id] })} />}
      <div className="flex justify-end gap-2"><button type="button" disabled={busy === record.id} onClick={() => void reject(record)} className={`${buttonCls} text-red-600`}><XCircle size={13} className="mr-2 inline" />거절</button><button type="button" disabled={busy === record.id || (isSuper && !record.organizationId)} onClick={() => void approve(record)} className={`${buttonCls} bg-emerald-600 text-white`}><ShieldCheck size={13} className="mr-2 inline" />{busy === record.id ? '처리 중…' : '가입 승인'}</button></div>
    </article>)}</div>{!pendingUsers.length && <p className="text-sm text-stone-500">승인 대기 중인 사용자가 없습니다.</p>}</div>
  </section>;
}
