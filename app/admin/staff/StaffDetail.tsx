'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, field, button, roles, statuses, type Staff, type Property, type Role } from './types';

export default function StaffDetail({ staff, isAdmin, properties, selfId, onSaved, onClose }: { staff: Staff; allStaff: Staff[]; isAdmin: boolean; properties: Property[]; selfId?: string; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = useState(staff.name), [phone, setPhone] = useState(staff.phone);
  const [role, setRole] = useState<Role>(staff.role), [ids, setIds] = useState(staff.propertyIds);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState(staff.email), [inviteEmail, setInviteEmail] = useState(''), [inviteToken, setInviteToken] = useState('');
  const isSelf = staff.userId === selfId;
  async function action(work: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError(''); setMessage('');
    try { await work(); setMessage('저장했습니다.'); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.'); } finally { setBusy(false); }
  }
  const update = (data: object) => api('/api/users', 'PUT', { id: staff.userId, ...data });
  return <section className="space-y-6 border bg-white p-6" aria-label={`${staff.name} 직원 상세`}>
    <header className="flex justify-between gap-4"><div><h2 className="text-xl font-medium">{staff.name}</h2><p className="mt-2 text-sm text-stone-500">{roles[staff.role]} · {statuses[staff.status]}</p></div><button type="button" disabled={busy} className={button} onClick={onClose}>닫기</button></header>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void action(() => update({ displayName: name, phone, ...(isAdmin && !isSelf ? { role, ...(email.trim() && staff.status !== 'no_account' ? { email: email.trim() } : {}) } : {}) })); }}>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">이름<input className={field} required value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="text-sm">전화번호<input className={field} type="tel" value={phone} onChange={event => setPhone(event.target.value)} /></label>
        <label className="text-sm">관리 역할<select className={field} disabled={!isAdmin || isSelf} value={role} onChange={event => setRole(event.target.value as Role)}>{Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {staff.status !== 'no_account' && <label className="text-sm">로그인 이메일<input className={field} type="email" disabled={!isAdmin || isSelf} value={email} placeholder="전화번호 로그인" onChange={event => setEmail(event.target.value)} /></label>}
      </fieldset>
      <p className="text-xs text-stone-500">관리자·매니저·청소 담당자 모두 담당 숙소의 청소 일정에 배정할 수 있습니다. 매니저는 직원 관리와 직접 청소를 함께 수행합니다.</p>
      <button disabled={busy} className={button}>기본 정보 저장</button>
    </form>
    <form className="space-y-4 border-t pt-5" onSubmit={event => { event.preventDefault(); void action(() => update({ propertyIds: ids })); }}>
      <h3 className="font-medium">담당 숙소</h3>
      {staff.role === 'admin' ? <p className="text-sm">관리자는 전체 숙소를 담당합니다.</p> : <><fieldset disabled={busy || isSelf} className="space-y-3">{properties.map(p => <label key={p.id} className="flex gap-2 text-sm"><input type="checkbox" checked={ids.includes(p.id)} onChange={() => setIds(current => current.includes(p.id) ? current.filter(id => id !== p.id) : [...current, p.id])} />{p.name}</label>)}</fieldset><p className="text-xs text-stone-500">역할에 따른 관리·청소 업무에 같은 숙소 배정이 적용됩니다. 모두 해제하면 새 업무 접근을 중지하고 이력은 보존합니다.</p><button disabled={busy || isSelf} className={button}>담당 숙소 저장</button></>}
    </form>
    <div className="space-y-3 border-t pt-5"><h3 className="font-medium">로그인·개인 일정</h3><p className="text-sm">{staff.loginIdentifier || '로그인 없이 일정 링크 사용'}</p>
      {!isSelf && <><button type="button" disabled={busy} className={button} onClick={() => void action(async () => { const result = await api(`/api/cleaners/${staff.userId}/reset-password`, 'POST'); setPassword(result.initialPassword); })}>{staff.status === 'no_account' ? '로그인 비밀번호 발급' : '초기 비밀번호 재발급'}</button>{staff.status !== 'no_account' && <button type="button" disabled={busy} className={button} onClick={() => void action(() => update({ status: staff.status === 'active' ? 'suspended' : 'active' }))}>{staff.status === 'active' ? '로그인 중지' : '로그인 허용'}</button>}</>}
      {password && <div className="border p-3 text-sm"><p>초기 비밀번호는 이 화면에서만 표시합니다.</p><code className="break-all">{password}</code></div>}
      {staff.status === 'no_account' && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void action(async () => { const result = await api(`/api/cleaners/${staff.userId}/invite`, 'POST', { email: inviteEmail }); setInviteToken(result.token); }); }}><label className="block text-sm">이메일로 로그인 초대<input required type="email" disabled={busy} className={field} value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} /></label><button disabled={busy} className={button}>초대 링크 만들기</button>{inviteToken && <button type="button" disabled={busy} className={button} onClick={() => void action(() => navigator.clipboard.writeText(`${location.origin}/invite/${inviteToken}`))}>초대 링크 복사</button>}</form>}
      {isSelf && <Link className="block text-sm underline" href="/cleaner">내 청소 업무</Link>}
      {staff.publicToken && <button type="button" disabled={busy} className={button} onClick={() => void action(() => navigator.clipboard.writeText(`${location.origin}/c/${staff.publicToken}`))}>일정 링크 복사</button>}
      <button type="button" disabled={busy} className={button} onClick={() => void action(() => update({ regenerateToken: true }))}>{staff.publicToken ? '일정 링크 재발급' : '일정 링크 만들기'}</button>
    </div>
    <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy || !staff.phone} checked={staff.notifyNewOpen} onChange={event => void action(() => update({ notifyNewOpen: event.target.checked }))} />담당 숙소의 새 청소 알림 받기</label>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}{message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
  </section>;
}
