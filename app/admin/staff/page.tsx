'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { api, button, field, roles, statuses, type Staff, type Property, type Role } from './types';
import CreateStaffForm from './CreateStaffForm';
import StaffDetail from './StaffDetail';
import InvitationsPanel from './InvitationsPanel';

export default function StaffPage() {
  const { user, profile, refreshProfile } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]); const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [filter, setFilter] = useState<Role | 'all'>('all'); const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null); const [creating, setCreating] = useState(false); const [invitations, setInvitations] = useState(false);
  const isAdmin = profile?.role === 'admin';
  const load = useCallback(async () => { setError(''); try { const result = await api('/api/staff'); setStaff(result.staff); setProperties(result.properties); } catch (cause) { setError(cause instanceof Error ? cause.message : '직원 목록을 불러오지 못했습니다.'); } finally { setLoading(false); } }, []);
  useEffect(() => { if (user && profile?.role !== 'cleaner') void load(); }, [user, profile?.role, load]);
  const current = staff.find(item => item.key === selected);
  const results = staff.filter(item => (filter === 'all' || item.role === filter) && `${item.name} ${item.phone} ${item.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="mx-auto max-w-6xl space-y-7">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6"><div><p className="text-xs tracking-widest text-stone-500">TEAM</p><h1 className="mt-2 text-3xl font-light">직원 관리</h1><p className="mt-3 text-sm text-stone-600">관리자·매니저·청소 담당자의 연락처, 담당 숙소와 로그인 상태를 한곳에서 관리합니다.</p>{!isAdmin && <p className="mt-2 text-xs text-stone-500">내가 등록한 청소 담당자만 관리할 수 있습니다.</p>}</div><div className="flex gap-2"><button type="button" className={`${button} bg-[var(--brand)] text-white`} onClick={() => { setCreating(true); setSelected(null); setInvitations(false); }}>직원 등록</button>{isAdmin && <button type="button" className={button} onClick={() => { setInvitations(value => !value); setSelected(null); setCreating(false); }}>초대·가입 승인</button>}</div></header>
    {error && <div role="alert" className="border border-red-200 p-4 text-sm text-red-600">{error}<button type="button" onClick={load} className="ml-4 underline">다시 불러오기</button></div>}
    {creating && <CreateStaffForm isAdmin={isAdmin} properties={properties} onCreated={() => void load()} onClose={() => setCreating(false)} />}
    {invitations && isAdmin && <InvitationsPanel onChanged={() => void load()} />}
    {current && <StaffDetail key={`${current.key}:${current.role}`} staff={current} properties={properties} selfId={user?.id} onSaved={() => { void load(); void refreshProfile(); }} onClose={() => setSelected(null)} />}
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div className="flex flex-wrap gap-2" role="group" aria-label="직원 역할 필터">{(['all', 'admin', 'manager', 'cleaner'] as const).map(role => <button type="button" key={role} aria-pressed={filter === role} className={`${button} ${filter === role ? 'bg-stone-900 text-white' : 'bg-white'}`} onClick={() => setFilter(role)}>{role === 'all' ? '전체' : roles[role]} <span className="ml-1 opacity-60">{staff.filter(item => role === 'all' || item.role === role).length}</span></button>)}</div><label className="text-sm">직원 검색<input type="search" placeholder="이름 · 연락처 · 이메일" value={query} onChange={event => setQuery(event.target.value)} className={field} /></label></div>
    {loading ? <p role="status" className="py-10 text-sm">직원 목록을 불러오는 중…</p> : <div className="space-y-3">{results.map(item => <button type="button" key={item.key} aria-expanded={selected === item.key} onClick={() => { setSelected(item.key); setCreating(false); setInvitations(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className={`grid w-full gap-3 border bg-white p-5 text-left sm:grid-cols-[1.2fr_1fr_1.4fr_auto] sm:items-center ${selected === item.key ? 'border-[var(--brand)]' : 'border-stone-200 hover:border-stone-400'}`}>
      <span><span className="block font-medium">{item.name}</span><span className="mt-1 block text-xs text-stone-500">{item.phone ? item.phone.replace(/^(010)(\d{4})(\d{4})$/, '$1-$2-$3') : '휴대폰 미등록'}</span></span>
      <span className="text-sm">{roles[item.role]}</span><span className="text-sm text-stone-600">{item.scope === 'all' ? item.cleanerId ? '소유 운영자의 전체 숙소' : '전체 숙소' : item.scope === 'none' ? '배정 없음' : item.propertyIds.map(id => properties.find(p => p.id === id)?.name || '조회 범위 밖 숙소').join(', ')}</span>
      <span className="text-xs text-stone-500">{statuses[item.status] || item.status} · 상세 보기</span>
    </button>)}{!results.length && !error && <p className="border border-dashed p-10 text-center text-sm text-stone-500">{query || filter !== 'all' ? '조건에 맞는 직원이 없습니다.' : '등록된 직원이 없습니다. 직원 등록으로 시작하세요.'}</p>}</div>}
  </div>;
}
