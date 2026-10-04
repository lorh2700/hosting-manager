'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import CreateUserForm from '../users/CreateUserForm';
import { api, field, button, roles, type Role, type Scope, type Property } from './types';

export default function CreateStaffForm({ isAdmin, properties, initialOrganizationId, onCreated, onClose }: { isAdmin: boolean; properties: Property[]; initialOrganizationId?: string; onCreated: () => void; onClose: () => void }) {
  const { profile } = useAuth(); const isSuper = profile?.role === 'super_admin';
  const [role, setRole] = useState<Role>(isAdmin ? 'manager' : 'cleaner');
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<Scope>('none'); const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [loginEnabled, setLoginEnabled] = useState(true); const [notifyNewOpen, setNotifyNewOpen] = useState(true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [result, setResult] = useState<{ phone: string; initialPassword: string | null } | null>(null);
  const [showPassword, setShowPassword] = useState(false); const [created, setCreated] = useState(false);
  const [organizations, setOrganizations] = useState<{ id: string; name: string; status: string }[]>([]), [organizationId, setOrganizationId] = useState(initialOrganizationId || '');
  const [organizationsLoading, setOrganizationsLoading] = useState(isSuper), [availableProperties, setAvailableProperties] = useState(properties);
  const scopedProperties = availableProperties.filter(property => (property.organizationId || null) === (isSuper ? organizationId || null : profile?.organizationId || null));
  useEffect(() => {
    if (!isSuper) return;
    const controller = new AbortController(); setOrganizationsLoading(true);
    void fetch('/api/staff?picker=1', { signal: controller.signal }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || '사업자 목록을 불러오지 못했습니다.'); if (controller.signal.aborted) return; setOrganizations(result.organizations.filter((item: { status: string }) => item.status === 'active')); setAvailableProperties(result.properties); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '사업자 목록을 불러오지 못했습니다.'); }).finally(() => { if (!controller.signal.aborted) setOrganizationsLoading(false); });
    return () => controller.abort();
  }, [isSuper]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { if (isSuper && !organizationId) throw new Error('청소 인력의 소속 사업자를 선택해 주세요.'); const saved = await api('/api/staff', 'POST', { name, phone, mode, propertyIds, loginEnabled, notifyNewOpen, ...(isSuper ? { organizationId } : {}) }); setResult(saved); setCreated(true); onCreated(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '등록하지 못했습니다.'); } finally { setBusy(false); }
  }
  return <section className="border border-stone-300 bg-white p-5 space-y-5">
    <div className="flex items-center justify-between"><h2 className="text-lg font-medium">직원 등록</h2><button type="button" onClick={onClose} disabled={busy} className={button}>닫기</button></div>
    {!created && <label className="block text-sm">담당 역할<select value={role} disabled={busy} onChange={event => setRole(event.target.value as Role)} className={field}>{(isAdmin ? ['manager', 'cleaner'] as Role[] : ['cleaner'] as Role[]).map(value => <option key={value} value={value}>{roles[value]}</option>)}</select></label>}
    {organizationsLoading && role !== 'cleaner' ? <p role="status" className="text-sm">사업자와 담당 숙소를 불러오는 중…</p> : role !== 'cleaner' ? <CreateUserForm embedded onSavingChange={setBusy} key={role} initial={{ email: '', role: 'manager', propertyIds: [], organizationId: initialOrganizationId }} properties={availableProperties} onCreated={() => { setCreated(true); onCreated(); }} onClose={onClose} />
      : result ? <div className="space-y-4"><p>{name}님을 등록했습니다.</p><p className="text-sm text-stone-600">{result.initialPassword ? '로그인 정보를 담당자에게 전달해 주세요. 닫은 뒤에는 초기 비밀번호를 다시 표시하지 않습니다.' : '로그인 없이 일정 링크를 사용할 수 있습니다. 상세 화면에서 로그인 비밀번호를 발급할 수 있습니다.'}</p>
        {result.initialPassword && <><label className="block text-sm">전화번호<input readOnly value={result.phone} className={field} /></label><label className="block text-sm">초기 비밀번호<input readOnly type={showPassword ? 'text' : 'password'} value={result.initialPassword} className={field} /></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />비밀번호 표시</label><button type="button" className={button} onClick={async () => { try { await navigator.clipboard.writeText(`전화번호: ${result.phone}\n초기 비밀번호: ${result.initialPassword}`); } catch { setError('복사하지 못했습니다.'); } }}>로그인 정보 복사</button></>}
      </div> : <form onSubmit={submit} className="space-y-5"><fieldset disabled={busy || organizationsLoading} className="space-y-5">
        {isSuper && <label className="block text-sm">소속 사업자<select required value={organizationId} onChange={event => { setOrganizationId(event.target.value); setPropertyIds([]); }} className={field}><option value="">{organizationsLoading ? '사업자 불러오는 중…' : '사업자를 선택해 주세요'}</option>{organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {!isSuper && <p className="text-sm">소속 사업자: {profile?.organizationName || '사업자 미배정'}</p>}
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">이름<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} className={field} /></label><label className="text-sm">휴대폰 번호<input required type="tel" maxLength={40} placeholder="010-1234-5678" value={phone} onChange={event => setPhone(event.target.value)} className={field} /></label></div>
        <label className="block text-sm">담당 숙소<select value={mode} onChange={event => setMode(event.target.value as Scope)} className={field}><option value="none">배정 없음</option><option value="selected">선택한 숙소</option><option value="all">이 사업자의 관리 가능한 모든 숙소</option></select></label>
        {mode === 'selected' && <div className="flex flex-wrap gap-3">{scopedProperties.map(p => <label key={p.id} className="flex gap-2 text-sm"><input type="checkbox" checked={propertyIds.includes(p.id)} onChange={() => setPropertyIds(ids => ids.includes(p.id) ? ids.filter(id => id !== p.id) : [...ids, p.id])} />{p.name}</label>)}</div>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={loginEnabled} onChange={event => setLoginEnabled(event.target.checked)} />앱 로그인도 함께 만들기</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notifyNewOpen} onChange={event => setNotifyNewOpen(event.target.checked)} />새 청소 오픈 알림 받기</label>
        <p className="text-xs text-stone-500">로그인은 전화번호와 자동 생성된 초기 비밀번호를 사용합니다. 배정 없음 상태에서는 새 청소 조회·신청·오픈 알림을 받지 않습니다.</p>
        <button type="submit" disabled={isSuper && !organizationId} className={`${button} bg-[var(--brand)] text-white`}>{busy ? '등록 중…' : '직원 등록'}</button>
      </fieldset></form>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </section>;
}
