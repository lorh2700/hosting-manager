'use client';

import { useEffect, useState } from 'react';
import { Bell, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/components/ui';
import { MAX_INQUIRY_RECIPIENTS, inquiryNotificationSettingsSchema, type InquiryNotificationSettingsInput } from '@/lib/inquiry-notification-settings';

const emptySettings: InquiryNotificationSettingsInput = { enabled: false, recipients: [] };
type Member = { userId: string; name: string; phone: string; role: string };
const fieldClass = 'w-full border border-stone-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15';

export default function InquiryNotificationSettings({ propertyId }: { propertyId: string }) {
  const [settings, setSettings] = useState(emptySettings);
  const [members, setMembers] = useState<Member[]>([]);
  const [saved, setSaved] = useState(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    setSaveError('');
    void (async () => {
      try {
        const response = await fetch(`/api/properties/${propertyId}/inquiry-notifications`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '알림 수신자 설정을 불러오지 못했습니다.');
        const parsed = inquiryNotificationSettingsSchema.parse({ enabled: data.enabled, recipients: data.recipients });
        if (!Array.isArray(data.members)) throw new Error('회원 목록을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
        if (!controller.signal.aborted) { setSettings(parsed); setSaved(parsed); setMembers(data.members); }
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : '알림 수신자 설정을 불러오지 못했습니다.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [propertyId, attempt]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaveError('');
    if (settings.recipients.some(recipient => !recipient.userId)) { setSaveError('각 수신자를 등록된 회원 중에서 선택해 주세요.'); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/properties/${propertyId}/inquiry-notifications`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: settings.enabled, recipients: settings.recipients.map(recipient => ({ userId: recipient.userId })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '알림 수신자 설정을 저장하지 못했습니다.');
      const next = inquiryNotificationSettingsSchema.parse(data);
      setSettings(next); setSaved(next);
      setMembers(current => current.map(member => {
        const recipient = next.recipients.find(item => item.userId === member.userId);
        return recipient ? { ...member, name: recipient.name, phone: recipient.phone } : member;
      }));
      toast.success('고객 문의 알림 수신자가 저장되었습니다.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '알림 수신자 설정을 저장하지 못했습니다.');
    } finally { setSaving(false); }
  }

  async function refreshMembers() {
    if (refreshing) return;
    setRefreshing(true); setSaveError('');
    try {
      const response = await fetch(`/api/properties/${propertyId}/inquiry-notifications`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.members)) throw new Error(data.error || '회원 목록을 불러오지 못했습니다.');
      // Keep unsaved selections; only refresh the member directory.
      setMembers(data.members);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : '회원 목록을 불러오지 못했습니다.'); }
    finally { setRefreshing(false); }
  }

  function selectMember(index: number, userId: string) {
    const member = members.find(item => item.userId === userId);
    setSettings(current => ({ ...current, recipients: current.recipients.map((recipient, i) => i === index ? { userId: member?.userId, name: member?.name || '', phone: member?.phone || '' } : recipient) }));
  }

  return <section aria-labelledby="inquiry-notification-heading" className="bg-white border border-stone-200 p-5 sm:p-8 max-w-3xl">
    <h2 id="inquiry-notification-heading" className="flex items-center gap-2 text-lg font-light tracking-wide text-stone-900"><Bell size={18} /> 고객 문의 알림</h2>
    <p className="mt-3 text-sm leading-relaxed text-stone-600">등록된 회원 중 카카오톡 알림을 받을 담당자를 선택하세요. 활성 관리자와 이 숙소에 배정된 매니저를 최대 {MAX_INQUIRY_RECIPIENTS}명까지 지정할 수 있습니다. 휴대폰 번호는 회원 정보에서 가져옵니다.</p>
    <p className="mt-3 rounded bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-600">담당자 확인이 필요한 문의의 한국어 요약과 상담 링크를 받습니다. 알림 수신을 끄면 이 숙소의 자동답변도 함께 중지됩니다.</p>
    {loading ? <p role="status" className="mt-6 text-sm text-stone-500">수신자 설정을 불러오는 중…</p>
      : loadError ? <div className="mt-6"><p role="alert" className="text-sm text-red-600">{loadError}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 text-sm underline">다시 불러오기</button></div>
        : <form onSubmit={save} className="mt-6 space-y-5">
          <fieldset disabled={saving} className="space-y-5 disabled:opacity-60">
            <label className="flex items-center gap-3 text-sm font-medium text-stone-800">
              <input type="checkbox" checked={settings.enabled} onChange={event => setSettings(current => ({ ...current, enabled: event.target.checked }))} className="h-4 w-4 accent-[var(--brand)]" />
              이 숙소의 고객 문의 알림 받기
            </label>
            {!settings.enabled && <p className="text-xs text-stone-500">수신자를 저장해 두고 알림 수신만 꺼둘 수 있습니다.</p>}
            <div className="flex flex-wrap items-center gap-3 text-xs"><a href="/admin/staff" target="_blank" rel="noopener noreferrer" className="underline">직원 정보 확인·수정 (새 창)</a><button type="button" onClick={refreshMembers} disabled={refreshing} className="min-h-10 underline disabled:opacity-40">{refreshing ? '회원 목록 갱신 중…' : '회원 목록 새로 불러오기'}</button></div>
            {!members.length && <p role="status" className="rounded bg-amber-50 p-3 text-xs text-amber-900">선택할 수 있는 활성 회원이 없습니다. 직원 관리에서 관리자 계정 또는 이 숙소에 배정된 매니저 계정을 확인해 주세요.</p>}
            {settings.recipients.length === 0 && <p className="border border-dashed border-stone-200 p-5 text-sm text-stone-500">등록된 수신자가 없습니다. 아래에서 담당자를 추가하세요.</p>}
            {settings.recipients.map((recipient, index) => <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto] gap-3 border-b border-stone-100 pb-4">
              <label className="block text-xs text-stone-600">수신자 이름
                <select required value={recipient.userId || ''} onChange={event => selectMember(index, event.target.value)} className={`${fieldClass} mt-2`}>
                  <option value="">{recipient.name && !recipient.userId ? `${recipient.name} · 회원을 다시 선택해 주세요` : '회원을 선택하세요'}</option>
                  {recipient.userId && !members.some(member => member.userId === recipient.userId) && <option value={recipient.userId} disabled>선택한 회원의 상태·숙소 배정을 확인해 주세요</option>}
                  {members.map(member => {
                    const alreadySelected = settings.recipients.some((item, i) => i !== index && item.userId === member.userId);
                    return <option key={member.userId} value={member.userId} disabled={alreadySelected}>{member.name} · {member.role === 'admin' ? '관리자' : '매니저'} · {member.phone || '휴대폰 등록·확인 필요'}{alreadySelected ? ' · 이미 선택됨' : ''}</option>;
                  })}
                </select>
                {recipient.userId && members.some(member => member.userId === recipient.userId && !member.phone) && <span role="status" className="mt-2 block text-xs leading-5 text-amber-800">회원은 선택되었습니다. 저장하려면 직원 정보에 올바른 휴대폰 번호를 등록한 뒤 회원 목록을 새로 불러와 주세요.</span>}
              </label>
              <label className="block text-xs text-stone-600">카카오톡 휴대폰 번호
                <input readOnly type="tel" value={recipient.userId ? (members.find(member => member.userId === recipient.userId)?.phone || '') : recipient.phone} placeholder="회원 선택 시 자동 입력" className={`${fieldClass} mt-2 bg-stone-50`} />
              </label>
              <button type="button" aria-label={`${recipient.name || `${index + 1}번 수신자`} 삭제`} onClick={() => setSettings(current => ({ ...current, recipients: current.recipients.filter((_, i) => i !== index) }))} className="self-end justify-self-end p-3 text-stone-500 hover:text-red-600"><Trash2 size={18} /></button>
            </div>)}
            <button type="button" disabled={settings.recipients.length >= MAX_INQUIRY_RECIPIENTS} onClick={() => setSettings(current => ({ ...current, recipients: [...current.recipients, { name: '', phone: '' }] }))} className="flex items-center gap-2 border border-stone-300 px-4 py-2 text-sm text-stone-700 disabled:opacity-40"><Plus size={16} /> 수신자 추가</button>
          </fieldset>
          {saveError && <p role="alert" className="text-sm text-red-600">{saveError}</p>}
          <div className="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-5">
            <button type="submit" disabled={saving || !dirty} className="bg-[var(--brand)] hover:bg-[var(--brand-dark)] px-5 py-3 text-sm text-white disabled:opacity-40">{saving ? '저장 중…' : '알림 수신자 저장'}</button>
            <p aria-live="polite" className="text-xs text-stone-500">{dirty ? '아직 저장하지 않은 변경사항이 있습니다.' : '저장된 수신자 설정입니다.'}</p>
          </div>
        </form>}
  </section>;
}
