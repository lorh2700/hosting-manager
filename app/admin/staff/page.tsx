'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { button, field, roles, statuses, type Staff, type Property, type Role, type Organization } from './types';
import { STAFF_PLATFORM_SCOPE, STAFF_UNASSIGNED_SCOPE, staffOrganizationKey, staffOrganizationName } from '@/lib/staff-organizations';
import CreateStaffForm from './CreateStaffForm';
import StaffDetail from './StaffDetail';
import InvitationsPanel from './InvitationsPanel';

export default function StaffPage() {
  const { user, profile, refreshProfile } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]); const [properties, setProperties] = useState<Property[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]), [organizationScope, setOrganizationScope] = useState('');
  const request = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [filter, setFilter] = useState<Role | 'all'>('all'); const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null); const [creating, setCreating] = useState(false); const [invitations, setInvitations] = useState(false);
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';
  const isSuper = profile?.role === 'super_admin';
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setError(''); setLoading(true);
    try {
      const response = await fetch(`/api/staff${isSuper && organizationScope ? `?organizationId=${encodeURIComponent(organizationScope)}` : ''}`, { signal: controller.signal });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '직원 목록을 불러오지 못했습니다.');
      if (controller.signal.aborted) return;
      setStaff(result.staff); setProperties(result.properties); setOrganizations(result.organizations || []);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '직원 목록을 불러오지 못했습니다.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [isSuper, organizationScope]);
  useEffect(() => { if (user && profile?.role !== 'cleaner') void load(); return () => request.current?.abort(); }, [user, profile?.role, load]);
  const current = staff.find(item => item.key === selected);
  const results = staff.filter(item => (filter === 'all' || item.roles.includes(filter)) && `${item.name} ${item.phone} ${item.email} ${staffOrganizationName(item, organizations)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groupKeys = [...new Set(results.map(staffOrganizationKey))];
  const selectedOrganization = organizations.find(item => item.id === organizationScope);
  return <div className="mx-auto max-w-6xl space-y-7">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6"><div><p className="text-xs tracking-widest text-stone-500">TEAM</p><h1 className="mt-2 text-3xl font-light">직원 관리</h1><p className="mt-3 text-sm text-stone-600">관리자·매니저·청소 담당자의 연락처, 담당 숙소와 로그인 상태를 한곳에서 관리합니다.</p>{!isAdmin && <p className="mt-2 text-xs text-stone-500">내 정보와 내가 등록한 청소 담당자를 관리할 수 있습니다.</p>}</div><div className="flex gap-2"><button type="button" className={`${button} bg-[var(--brand)] text-white`} onClick={() => { setCreating(true); setSelected(null); setInvitations(false); }}>직원 등록</button>{isAdmin && <button type="button" className={button} onClick={() => { setInvitations(value => !value); setSelected(null); setCreating(false); }}>초대·가입 승인</button>}</div></header>
    {error && <div role="alert" className="border border-red-200 p-4 text-sm text-red-600">{error}<button type="button" onClick={load} className="ml-4 underline">다시 불러오기</button></div>}
    <section className="border border-stone-200 bg-white p-5" aria-label="직원 소속 사업자">
      {isSuper ? <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><label className="block w-full text-sm sm:max-w-md">소속 사업자<select className={field} value={organizationScope} onChange={event => { setOrganizationScope(event.target.value); setSelected(null); setCreating(false); setInvitations(false); }}><option value="">전체 사업자</option>{organizations.map(item => <option key={item.id} value={item.id}>{item.name}{item.status !== 'active' ? ' · 사용 중지' : ''}</option>)}<option value={STAFF_UNASSIGNED_SCOPE}>사업자 미배정</option><option value={STAFF_PLATFORM_SCOPE}>전체 사업자 관리 · 슈퍼매니저</option></select></label><p className="text-xs text-stone-500">사업자 명의에 따라 직원을 나누어 조회합니다.</p></div> : <div><p className="text-xs text-stone-500">소속 사업자</p><p className="mt-2 font-medium">{profile?.organizationName || organizations.find(item => item.id === profile?.organizationId)?.name || '사업자 미배정'}</p><p className="mt-2 text-xs text-stone-500">{isAdmin ? '내 사업자의 직원과 숙소만 표시합니다.' : '내 사업자에서 관리할 수 있는 직원과 담당 숙소만 표시합니다.'}</p></div>}
    </section>
    {creating && <CreateStaffForm isAdmin={isAdmin} properties={properties} initialOrganizationId={selectedOrganization?.id} onCreated={() => void load()} onClose={() => setCreating(false)} />}
    {invitations && isAdmin && <InvitationsPanel initialOrganizationId={selectedOrganization?.id} onChanged={() => void load()} />}
    {current && <StaffDetail key={`${current.key}:${current.role}`} staff={current} allStaff={staff} isAdmin={isAdmin} properties={properties.filter(property => (property.organizationId || null) === (current.organizationId || null))} selfId={user?.id} onSaved={() => { void load(); void refreshProfile(); }} onClose={() => setSelected(null)} />}
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div className="flex flex-wrap gap-2" role="group" aria-label="직원 역할 필터">{(isSuper ? ['all', 'super_admin', 'admin', 'manager', 'cleaner'] as const : ['all', 'admin', 'manager', 'cleaner'] as const).map(role => <button type="button" key={role} aria-pressed={filter === role} className={`${button} ${filter === role ? 'bg-stone-900 text-white' : 'bg-white'}`} onClick={() => setFilter(role)}>{role === 'all' ? '전체' : roles[role]} <span className="ml-1 opacity-60">{loading ? '…' : staff.filter(item => role === 'all' || item.roles.includes(role)).length}</span></button>)}</div><label className="text-sm">직원 검색<input type="search" placeholder="이름 · 연락처 · 이메일 · 사업자" value={query} onChange={event => setQuery(event.target.value)} className={field} /></label></div>
    {loading ? <p role="status" className="py-10 text-sm">직원 목록을 불러오는 중…</p> : !error && <div className="space-y-7">{groupKeys.map(groupKey => {
      const members = results.filter(item => staffOrganizationKey(item) === groupKey);
      return <section key={groupKey} className="space-y-3" aria-label={`${staffOrganizationName(members[0], organizations)} 직원 목록`}><h2 className="flex flex-wrap items-center gap-2 text-base font-medium">{staffOrganizationName(members[0], organizations)}<span className="text-xs font-normal text-stone-500">{members.length}명</span></h2>{members.map(item => <button type="button" key={item.key} aria-expanded={selected === item.key} onClick={() => { setSelected(item.key); setCreating(false); setInvitations(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className={`grid w-full gap-3 border bg-white p-5 text-left sm:grid-cols-[1.2fr_1fr_1.4fr_auto] sm:items-center ${selected === item.key ? 'border-[var(--brand)]' : 'border-stone-200 hover:border-stone-400'}`}>
      <span><span className="block font-medium">{item.name}</span><span className="mt-1 block text-xs text-stone-500">{item.phone ? item.phone.replace(/^(010)(\d{4})(\d{4})$/, '$1-$2-$3') : '휴대폰 미등록'}</span></span>
      <span className="text-sm"><span className="block">{roles[item.role]}</span><span className="mt-1 block text-xs text-stone-500">{staffOrganizationName(item, organizations)}</span></span><span className="text-sm text-stone-600">{item.role === 'super_admin' ? '전체 사업자' : item.role === 'admin' ? item.organizationId ? '소속 사업자의 모든 숙소' : '사업자 연결 필요' : item.propertyIds.map(id => properties.find(p => p.id === id)?.name || '조회 범위 밖 숙소').join(', ') || '배정 없음'}</span>
      <span className="text-xs text-stone-500">{statuses[item.status] || item.status} · 상세 보기</span>
    </button>)}</section>;
    })}{!results.length && <p className="border border-dashed p-10 text-center text-sm text-stone-500">{query || filter !== 'all' ? '조건에 맞는 직원이 없습니다.' : organizationScope ? '선택한 범위에 등록된 직원이 없습니다.' : '등록된 직원이 없습니다. 직원 등록으로 시작하세요.'}</p>}</div>}
  </div>;
}
