'use client';

import { useEffect, useState } from 'react';
import { toast } from '@/components/ui';

type Settings = { enabled: boolean; knowledge: string; missing: string[] };
export default function InquiryAutomationSettings({ propertyId }: { propertyId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setSettings(null);
    void fetch(`/api/properties/${propertyId}/inquiry-automation`, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '설정을 불러오지 못했습니다.');
      if (!controller.signal.aborted) { setSettings(data); setSaved(JSON.stringify({ enabled: data.enabled, knowledge: data.knowledge })); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '설정을 불러오지 못했습니다.'); });
    return () => controller.abort();
  }, [propertyId, attempt]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!settings) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/properties/${propertyId}/inquiry-automation`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: settings.enabled, knowledge: settings.knowledge }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '설정을 저장하지 못했습니다.');
      setSettings(data); setSaved(JSON.stringify({ enabled: data.enabled, knowledge: data.knowledge }));
      toast.success('자동답변 설정을 저장했습니다.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '설정을 저장하지 못했습니다.'); }
    finally { setSaving(false); }
  }
  const dirty = settings && saved !== JSON.stringify({ enabled: settings.enabled, knowledge: settings.knowledge });
  return <section className="max-w-3xl border border-stone-200 bg-white p-5 sm:p-8" aria-labelledby="inquiry-ai-heading">
    <h2 id="inquiry-ai-heading" className="text-lg font-light text-stone-900">GPT 자동답변</h2>
    <p className="mt-3 text-sm leading-relaxed text-stone-600">숙소 안내와 해당 예약 정보를 바탕으로 고객 언어에 맞춰 답변합니다. 환불·불만·예외 요청이나 근거가 부족한 문의는 카카오톡으로 알리고 담당자 응대로 전환합니다.</p>
    {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
    {!settings ? <div className="mt-5 text-sm">{error ? <button type="button" className="underline" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button> : <p role="status">불러오는 중…</p>}</div> : <form onSubmit={save} className="mt-6 space-y-5">
      <fieldset disabled={saving} className="space-y-5">
        <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} />이 숙소의 자동답변 사용</label>
        <label className="block text-sm text-stone-700">자동답변에 사용할 숙소 안내문
          <textarea value={settings.knowledge} onChange={event => setSettings({ ...settings, knowledge: event.target.value })} rows={12} maxLength={16000} placeholder={'정확한 숙소 정보를 입력하세요.\n\n체크인·체크아웃 시간:\n주차 안내:\n위치와 오시는 길:\n와이파이 이용 방법:\n시설 이용 및 주의사항:'} className="mt-2 w-full border border-stone-200 p-3 text-sm leading-relaxed focus:outline-none focus:border-[var(--brand)]" />
        </label>
        <p className="text-xs text-stone-500">안내문에 없는 정보는 추측하지 않습니다. 도어락 비밀번호·결제 정보 등 민감한 내용은 넣지 마세요. {settings.knowledge.length.toLocaleString()} / 16,000자</p>
        {settings.missing.length > 0 && <p className="rounded bg-amber-50 p-3 text-xs text-amber-900">자동답변 시작 전 필요한 설정: {settings.missing.join(', ')}. 안내문은 먼저 저장할 수 있습니다.</p>}
        <p className="text-xs leading-relaxed text-stone-500">고객 문의 알림 수신자를 먼저 저장해 주세요. 켠 시점 이후의 새 문의부터 처리하며, 메시지는 현재 약 15분 간격으로 확인합니다. 상담 화면에서 직접 응대를 시작하면 해당 대화의 자동답변이 멈춥니다.</p>
        <button disabled={saving || !dirty} type="submit" className="bg-[var(--brand)] px-5 py-3 text-sm text-white disabled:opacity-40">{saving ? '저장 중…' : '자동답변 설정 저장'}</button>
      </fieldset>
    </form>}
  </section>;
}
