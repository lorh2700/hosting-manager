'use client';

import { useState } from 'react';
import { ROLE_LABELS, ROLE_DESCRIPTIONS } from '@/lib/constants';

type StaffRole = 'admin' | 'manager';
export interface CreateUserSeed { email: string; role: StaffRole; propertyIds: string[] }
export interface CreatedUser { id: string; email: string; displayName: string; phone: string; role: StaffRole; status: 'active'; propertyIds: string[]; createdAt?: string }
const inputClass = 'mt-2 w-full border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15';

export default function CreateUserForm({ initial, properties, onCreated, onClose, embedded = false, onSavingChange }: {
  initial: CreateUserSeed; properties: { id: string; name: string }[]; onCreated: (user: CreatedUser) => void; onClose: () => void;
  embedded?: boolean; onSavingChange?: (saving: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState(initial.email);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState(initial.role);
  const [propertyIds, setPropertyIds] = useState(initial.propertyIds);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState<{ email: string; password: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (saving) return;
    setError('');
    if (password !== confirmation) { setError('비밀번호 확인이 일치하지 않습니다.'); return; }
    setSaving(true);
    onSavingChange?.(true);
    try {
      const response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name, email, phone, password, role, propertyIds: role === 'manager' ? propertyIds : [] }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '사용자를 등록하지 못했습니다.');
      setCredentials({ email: result.email, password, name: result.displayName });
      setPassword(''); setConfirmation(''); setVisible(false);
      onCreated(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '등록 결과를 확인하지 못했습니다. 사용자 목록을 확인해 주세요.'); }
    finally { setSaving(false); onSavingChange?.(false); }
  }

  function generatePassword() {
    const value = Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('');
    setPassword(value); setConfirmation(value); setVisible(true);
  }

  if (credentials) return <section className="border border-emerald-200 bg-white p-5 sm:p-6" aria-labelledby="user-created-heading">
    <h2 id="user-created-heading" className="text-base font-medium text-stone-900">{credentials.name}님을 등록했습니다.</h2>
    <p className="mt-2 text-sm text-stone-500">아래 로그인 정보를 담당자에게 전달해 주세요. 이 화면을 닫으면 초기 비밀번호를 다시 표시하지 않습니다.</p>
    <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label className="text-xs text-stone-600">로그인 이메일<input readOnly value={credentials.email} className={inputClass} /></label>
      <label className="text-xs text-stone-600">초기 비밀번호<input readOnly type={visible ? 'text' : 'password'} autoComplete="off" value={credentials.password} className={inputClass} /></label>
    </div>
    <label className="mt-3 flex items-center gap-2 text-xs text-stone-600"><input type="checkbox" checked={visible} onChange={event => setVisible(event.target.checked)} />비밀번호 표시</label>
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" className="bg-[var(--brand)] px-5 py-2.5 text-sm text-white" onClick={async () => {
        try { await navigator.clipboard.writeText(`로그인 이메일: ${credentials.email}\n초기 비밀번호: ${credentials.password}`); setCopied(true); setError(''); }
        catch { setError('복사하지 못했습니다. 비밀번호를 표시한 뒤 직접 복사해 주세요.'); }
      }}>{copied ? '복사했습니다' : '로그인 정보 복사'}</button>
      <button type="button" onClick={onClose} className="border border-stone-300 px-5 py-2.5 text-sm text-stone-600">닫기</button>
    </div>
  </section>;

  return <section className={embedded ? '' : 'border border-stone-300 bg-white p-5 sm:p-6'} aria-labelledby={embedded ? undefined : 'create-user-heading'}>
    {!embedded && <h2 id="create-user-heading" className="text-sm font-medium text-stone-900">사용자 직접 등록</h2>}
    <p className="mt-2 text-sm leading-relaxed text-stone-500">등록 즉시 로그인할 수 있습니다. 이메일과 초기 비밀번호는 담당자에게 직접 전달해 주세요. 로그인 후 내 프로필에서 비밀번호를 변경할 수 있습니다.</p>
    <form onSubmit={submit} className="mt-5 space-y-5">
      <fieldset disabled={saving} className="space-y-5 disabled:opacity-60">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-xs text-stone-600">이름<input autoFocus required maxLength={100} autoComplete="off" value={name} onChange={event => setName(event.target.value)} className={inputClass} placeholder="사용자 이름" /></label>
          <label className="text-xs text-stone-600">로그인 이메일<input required type="email" maxLength={200} autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} className={inputClass} placeholder="user@example.com" /></label>
          <label className="text-xs text-stone-600">휴대폰 번호 (필수)<input required type="tel" maxLength={40} autoComplete="off" value={phone} onChange={event => setPhone(event.target.value)} className={inputClass} placeholder="010-1234-5678" /><span className="mt-2 block text-xs text-stone-500">010으로 시작하는 번호를 입력해 주세요.</span></label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-xs text-stone-600">초기 비밀번호<input required type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={72} value={password} onChange={event => setPassword(event.target.value)} className={inputClass} placeholder="8자 이상 입력" /></label>
          <label className="text-xs text-stone-600">비밀번호 확인<input required type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={72} value={confirmation} onChange={event => setConfirmation(event.target.value)} className={inputClass} placeholder="같은 비밀번호 다시 입력" /></label>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-stone-600">
          <button type="button" onClick={generatePassword} className="underline">비밀번호 자동 생성</button>
          <label className="flex items-center gap-2"><input type="checkbox" checked={visible} onChange={event => setVisible(event.target.checked)} />비밀번호 표시</label>
        </div>
        {!embedded && <label className="block text-xs text-stone-600">역할<select value={role} onChange={event => setRole(event.target.value as StaffRole)} className={inputClass}>
          {(['manager', 'admin'] as StaffRole[]).map(value => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}
        </select><span className="mt-2 block text-xs text-stone-500">{ROLE_DESCRIPTIONS[role]}</span></label>}
        {role === 'manager' && <div>
          <p className="mb-3 text-xs text-stone-600">배정 숙소</p>
          <div className="flex flex-wrap gap-2">{properties.map(property => <button type="button" key={property.id} aria-pressed={propertyIds.includes(property.id)} onClick={() => setPropertyIds(current => current.includes(property.id) ? current.filter(id => id !== property.id) : [...current, property.id])} className={`border px-3 py-2 text-xs ${propertyIds.includes(property.id) ? 'border-[var(--brand)] bg-[var(--brand-tint)] text-[var(--brand-dark)]' : 'border-stone-200 text-stone-500'}`}>{property.name}</button>)}</div>
          {!propertyIds.length && <p className="mt-2 text-xs text-stone-500">배정 숙소가 없으면 로그인 후 숙소 정보를 볼 수 없습니다. 나중에 배정할 수 있습니다.</p>}
        </div>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" disabled={saving} onClick={onClose} className="px-4 py-2 text-sm text-stone-500 disabled:opacity-50">취소</button>
        <button type="submit" disabled={saving} className="bg-[var(--brand)] hover:bg-[var(--brand-dark)] px-6 py-2.5 text-sm text-white disabled:opacity-50">{saving ? '등록 중…' : embedded ? '직원 등록' : '사용자 등록'}</button>
      </div>
    </form>
  </section>;
}
