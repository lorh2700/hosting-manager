'use client';

import { useEffect, useState } from 'react';
type Job = { messageId: string; status: string; summary: string; reason: string; draft: string; notifications: { name: string; status: string; error: string | null }[] };
type State = { enabled: boolean; paused: boolean; reason: string | null; jobs: Job[] };
const statuses: Record<string, string> = { queued: '문의 확인 대기', verify: '답변 검토 중', booking: '예약 확인 중', ready: '전송 전 확인 중', checked: '전송 대기', sending: '전송 중', sent: 'Beds24 접수 완료', escalated: '담당자 확인 필요', skipped: '자동답변 생략' };
const alerts: Record<string, string> = { pending: '대기', sending: '접수 중', accepted: '접수 완료', failed: '접수 실패', unknown: '접수 여부 확인 필요', cancelled: '취소' };

export default function InquiryAutomationPanel({ eventId, revision, onUseDraft }: { eventId: string; revision: number; onUseDraft: (draft: string) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/conversations/${eventId}/automation`, { signal: controller.signal });
        if (response.status === 404 || response.status === 403) return;
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '자동답변 상태를 불러오지 못했습니다.');
        if (!controller.signal.aborted) { setState(data); setError(''); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '상태 조회 실패'); }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 10000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [eventId, revision, refresh]);

  async function pause(paused: boolean, draft?: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/conversations/${eventId}/automation`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '응대 상태를 변경하지 못했습니다.');
      setState(current => current ? { ...current, paused } : current);
      if (draft) onUseDraft(draft);
      setRefresh(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '상태 변경 실패'); }
    finally { setBusy(false); }
  }
  if (!state && !error) return null;
  const job = state?.jobs[0];
  return <div className="border-b border-stone-200 bg-stone-50 px-4 py-3 text-xs">
    {state && <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-stone-700">{state.paused ? '담당자 응대 중 · 자동답변 중지' : state.enabled ? 'GPT 자동답변 사용 중' : 'GPT 자동답변 꺼짐'}</p>
        <button type="button" disabled={busy} onClick={() => void pause(!state.paused)} className="border border-stone-300 bg-white px-3 py-2 disabled:opacity-40">{busy ? '변경 중…' : state.paused ? '직접 응대 종료 · 자동답변 재개' : '직접 응대 시작'}</button>
      </div>
      {state.paused && <p className="mt-2 text-stone-500">{state.reason} 재개하면 그 이후에 도착하는 새 문의부터 자동답변합니다.</p>}
      {job && <details className="mt-3">
        <summary className="cursor-pointer text-stone-700">최근 처리: {statuses[job.status] || job.status}{job.summary ? ` · ${job.summary}` : ''}</summary>
        <div className="mt-2 space-y-2">
          {job.reason && <p>{job.reason}</p>}
          {job.status === 'escalated' && job.draft && <><p className="whitespace-pre-wrap rounded border border-stone-200 bg-white p-3">{job.draft}</p><button type="button" disabled={busy} className="underline" onClick={() => void pause(true, job.draft)}>초안을 입력창으로 가져오기</button></>}
          {job.status === 'escalated' && !job.notifications.length && <p className="text-amber-800">카카오톡 알림 대기 중입니다. 계속 표시되면 숙소의 수신자 설정을 확인해 주세요.</p>}
          {job.notifications.map((item, i) => <p key={i} className={['failed', 'unknown'].includes(item.status) ? 'text-amber-800' : 'text-stone-500'}>{item.name}: 카카오톡 {alerts[item.status] || item.status}{item.error ? ` — ${item.error}` : ''}</p>)}
        </div>
      </details>}
    </>}
    {error && <p role="alert" className="mt-2 text-red-600">{error}</p>}
  </div>;
}
