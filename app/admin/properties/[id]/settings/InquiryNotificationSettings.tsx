'use client';

import { useEffect, useState } from 'react';
import { Bell, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/components/ui';
import { MAX_INQUIRY_RECIPIENTS, inquiryNotificationSettingsSchema, type InquiryNotificationSettingsInput } from '@/lib/inquiry-notification-settings';

const emptySettings: InquiryNotificationSettingsInput = { enabled: false, recipients: [] };
const fieldClass = 'w-full border border-stone-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15';

export default function InquiryNotificationSettings({ propertyId }: { propertyId: string }) {
  const [settings, setSettings] = useState(emptySettings);
  const [saved, setSaved] = useState(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        const parsed = inquiryNotificationSettingsSchema.parse(data);
        if (!controller.signal.aborted) { setSettings(parsed); setSaved(parsed); }
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
    setSaveError('');
    const parsed = inquiryNotificationSettingsSchema.safeParse(settings);
    if (!parsed.success) { setSaveError(parsed.error.issues[0].message); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/properties/${propertyId}/inquiry-notifications`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '알림 수신자 설정을 저장하지 못했습니다.');
      const next = inquiryNotificationSettingsSchema.parse(data);
      setSettings(next); setSaved(next);
      toast.success('고객 문의 알림 수신자가 저장되었습니다.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '알림 수신자 설정을 저장하지 못했습니다.');
    } finally { setSaving(false); }
  }

  function updateRecipient(index: number, key: 'name' | 'phone', value: string) {
    setSettings(current => ({ ...current, recipients: current.recipients.map((recipient, i) => i === index ? { ...recipient, [key]: value } : recipient) }));
  }

  return <section aria-labelledby="inquiry-notification-heading" className="bg-white border border-stone-200 p-5 sm:p-8 max-w-3xl">
    <h2 id="inquiry-notification-heading" className="flex items-center gap-2 text-lg font-light tracking-wide text-stone-900"><Bell size={18} /> 고객 문의 알림</h2>
    <p className="mt-3 text-sm leading-relaxed text-stone-600">답변하기 어려운 고객 문의를 카카오톡으로 받을 담당자를 등록하세요. 이 숙소의 수신자는 최대 {MAX_INQUIRY_RECIPIENTS}명까지 지정할 수 있습니다.</p>
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
            {settings.recipients.length === 0 && <p className="border border-dashed border-stone-200 p-5 text-sm text-stone-500">등록된 수신자가 없습니다. 아래에서 담당자를 추가하세요.</p>}
            {settings.recipients.map((recipient, index) => <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto] gap-3 border-b border-stone-100 pb-4">
              <label className="block text-xs text-stone-600">수신자 이름
                <input required autoComplete="off" maxLength={50} value={recipient.name} onChange={event => updateRecipient(index, 'name', event.target.value)} placeholder="예: 예약 담당자" className={`${fieldClass} mt-2`} />
              </label>
              <label className="block text-xs text-stone-600">카카오톡 휴대폰 번호
                <input required type="tel" autoComplete="off" maxLength={40} value={recipient.phone} onChange={event => updateRecipient(index, 'phone', event.target.value)} placeholder="010-1234-5678" className={`${fieldClass} mt-2`} />
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
