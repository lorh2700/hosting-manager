'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui';
import { decodeKnowledgeFile, mergeKnowledge, KNOWLEDGE_TEMPLATE } from '@/lib/inquiry-knowledge';

type Settings = { enabled: boolean; knowledge: string; missing: string[] };
export default function InquiryAutomationSettings({ propertyId }: { propertyId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [fileDraft, setFileDraft] = useState<{ name: string; text: string } | null>(null);
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [reading, setReading] = useState(false);
  const fileVersion = useRef(0);
  const dirty = !!settings && saved !== JSON.stringify({ enabled: settings.enabled, knowledge: settings.knowledge });
  useEffect(() => {
    if (!dirty && !fileDraft) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty, fileDraft]);
  useEffect(() => {
    const controller = new AbortController();
    const invalidateFileReads = () => { fileVersion.current++; };
    setError(''); setSettings(null); setSaved(''); setFileDraft(null); setReading(false); fileVersion.current++;
    void fetch(`/api/properties/${propertyId}/inquiry-automation`, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '설정을 불러오지 못했습니다.');
      if (!controller.signal.aborted) { setSettings(data); setSaved(JSON.stringify({ enabled: data.enabled, knowledge: data.knowledge })); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '설정을 불러오지 못했습니다.'); });
    return () => { controller.abort(); invalidateFileReads(); };
  }, [propertyId, attempt]);
  function download(text: string, name: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file: File) {
    const version = ++fileVersion.current;
    setReading(true); setError(''); setFileDraft(null);
    try {
      if (file.size > 64 * 1024) throw new Error('파일은 64KB 이하로 준비해 주세요.');
      const text = decodeKnowledgeFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if (version === fileVersion.current) { setFileDraft({ name: file.name, text }); setImportMode('append'); }
    } catch (cause) { if (version === fileVersion.current) setError(cause instanceof Error ? cause.message : '파일을 읽지 못했습니다.'); }
    finally { if (version === fileVersion.current) setReading(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!settings || saving || reading || fileDraft) return;
    const version = fileVersion.current;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/properties/${propertyId}/inquiry-automation`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: settings.enabled, knowledge: settings.knowledge }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '설정을 저장하지 못했습니다.');
      if (version !== fileVersion.current) return;
      setSettings(data); setSaved(JSON.stringify({ enabled: data.enabled, knowledge: data.knowledge }));
      toast.success('자동답변 설정을 저장했습니다.');
    } catch (cause) { if (version === fileVersion.current) setError(cause instanceof Error ? cause.message : '설정을 저장하지 못했습니다.'); }
    finally { setSaving(false); }
  }
  const active = saved ? (JSON.parse(saved) as Settings).enabled : false;
  return <section className="max-w-3xl border border-stone-200 bg-white p-5 sm:p-8" aria-labelledby="inquiry-ai-heading">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="inquiry-ai-heading" className="text-lg font-medium text-stone-900">AI 자동응답 · 숙소 안내 자료</h2>
      {settings && <span className={`rounded-full px-3 py-1 text-xs font-medium ${active ? 'bg-green-50 text-green-800' : 'bg-stone-100 text-stone-600'}`}>현재 저장된 설정: {active ? '켜짐' : '꺼짐'}</span>}</div>
    <p className="mt-3 text-sm leading-relaxed text-stone-600">숙소 안내와 해당 예약 정보를 바탕으로 고객 언어에 맞춰 답변합니다. 환불·불만·예외 요청이나 근거가 부족한 문의는 카카오톡으로 알리고 담당자 응대로 전환합니다.</p>
    {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
    {!settings ? <div className="mt-5 text-sm">{error ? <button type="button" className="underline" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button> : <p role="status">불러오는 중…</p>}</div> : <form onSubmit={save} className="mt-6 space-y-5">
      <fieldset disabled={saving} className="space-y-5">
        <div className="rounded-xl bg-stone-50 p-4">
          <label className="flex items-center justify-between gap-3 text-sm font-medium">이 숙소의 AI 자동응답
            <input type="checkbox" role="switch" aria-label="이 숙소의 AI 자동응답" className="h-6 w-6 accent-[var(--brand)]" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} /></label>
          <p className="mt-2 text-xs text-stone-600">{settings.enabled ? '켜짐으로 설정' : '꺼짐으로 설정'} · 아래 저장 버튼을 누르면 적용됩니다. Beds24의 정기 예약 안내 메시지는 별도 설정입니다.</p>
        </div>
        <div className="space-y-3 rounded-xl border border-stone-200 p-4">
          <h3 className="text-sm font-medium">안내 자료 파일 추가</h3>
          <p className="text-xs leading-relaxed text-stone-600">숙소 안내와 자주 묻는 질문을 파일로 작성해 불러오세요. 저장한 내용은 이후 자동응답의 참고 자료로 사용됩니다. 과거 대화 전체를 자동 학습하거나 파일을 선택하는 즉시 발송하지 않습니다.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => download(KNOWLEDGE_TEMPLATE, '숙소-AI-안내문-양식.txt')} className="rounded border px-3 py-2 text-sm">작성 양식 받기</button>
            <button type="button" disabled={!settings.knowledge.trim()} onClick={() => download(settings.knowledge, `숙소-AI-안내문-${propertyId}.txt`)} className="rounded border px-3 py-2 text-sm disabled:opacity-40">편집 중인 안내문 내려받기</button>
          </div>
          <label className="block text-sm">TXT / MD 파일 · UTF-8 · 최대 64KB
            <input type="file" accept=".txt,.md" disabled={reading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }} className="mt-2 block w-full min-w-0 text-sm file:mr-3 file:rounded file:border file:bg-white file:px-3 file:py-2" /></label>
          {reading && <p role="status" className="text-xs">파일을 읽고 있습니다…</p>}
          {fileDraft && <div className="space-y-3 border-t pt-3">
            <p className="break-all text-sm font-medium">미리보기: {fileDraft.name}</p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-stone-50 p-3 text-xs">{fileDraft.text}</pre>
            <label className="block text-sm">반영 방식 <select value={importMode} onChange={event => setImportMode(event.target.value as 'append' | 'replace')} className="ml-2 rounded border p-2"><option value="append">기존 내용 뒤에 추가</option><option value="replace">기존 내용 전체 교체</option></select></label>
            {importMode === 'replace' && <p className="text-xs text-amber-800">편집 중인 안내문 전체가 파일 내용으로 바뀝니다.</p>}
            <div className="flex flex-wrap gap-2"><button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => {
              try { const knowledge = mergeKnowledge(settings.knowledge, fileDraft.text, importMode); setSettings({ ...settings, knowledge }); setFileDraft(null); setError(''); }
              catch (cause) { setError(cause instanceof Error ? cause.message : '내용을 추가하지 못했습니다.'); }
            }}>안내문에 반영</button><button type="button" className="px-3 py-2 text-sm underline" onClick={() => setFileDraft(null)}>파일 취소</button></div>
            <p className="text-xs text-stone-500">반영 후 아래 안내문을 검토하고 저장해 주세요.</p>
          </div>}
        </div>
        <label className="block text-sm text-stone-700">자동답변에 사용할 숙소 안내문 · 직접 편집 가능
          <textarea value={settings.knowledge} onChange={event => setSettings({ ...settings, knowledge: event.target.value })} rows={12} maxLength={16000} placeholder={'정확한 숙소 정보를 입력하세요.\n\n체크인·체크아웃 시간:\n주차 안내:\n위치와 오시는 길:\n와이파이 이용 방법:\n시설 이용 및 주의사항:'} className="mt-2 w-full border border-stone-200 p-3 text-sm leading-relaxed focus:outline-none focus:border-[var(--brand)]" />
        </label>
        <p className="text-xs text-stone-500">안내문에 없는 정보는 추측하지 않습니다. 도어락 비밀번호·결제 정보 등 민감한 내용은 넣지 마세요. {settings.knowledge.length.toLocaleString()} / 16,000자</p>
        {settings.missing.length > 0 && <p className="rounded bg-amber-50 p-3 text-xs text-amber-900">자동답변 시작 전 필요한 설정: {settings.missing.join(', ')}. 안내문은 먼저 저장할 수 있습니다.</p>}
        <p className="text-xs leading-relaxed text-stone-500">고객 문의 알림 수신자를 먼저 저장해 주세요. 켠 시점 이후의 새 문의부터 처리하며, 메시지는 현재 약 15분 간격으로 확인합니다. 상담 화면에서 직접 응대를 시작하면 해당 대화의 자동답변이 멈춥니다.</p>
        {dirty && <p role="status" className="text-xs text-amber-800">저장하지 않은 변경사항이 있습니다.</p>}
        {fileDraft && <p className="text-xs text-stone-600">선택한 파일을 안내문에 반영하거나 취소한 후 저장할 수 있습니다.</p>}
        <button disabled={saving || reading || !!fileDraft || !dirty} type="submit" className="bg-[var(--brand)] px-5 py-3 text-sm text-white disabled:opacity-40">{saving ? '저장 중…' : 'AI 응답 설정과 안내문 저장'}</button>
      </fieldset>
    </form>}
  </section>;
}
