'use client';

/** Today's operational data and actions; photos are read when the camera opens. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavigationLink as Link } from '@/components/NavigationFeedback';
import dynamic from 'next/dynamic';
import { format, parseISO, isToday } from 'date-fns';
import { PawPrint, ExternalLink, MessageSquare } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Badge, Button, Sheet, SkeletonList, PullToRefresh, toast, confirmDialog } from '@/components/ui';
import TodayBoard from './TodayBoard';
import { canUseOpsModule, needsOpsCleaning } from '@/lib/ops-attention';
import { todayKst } from '@/lib/dates';
import { readOps } from '@/lib/read-ops';
import { createOpsSnapshotCache } from '@/lib/ops-loading';
import { opsActionsBlocked } from '@/lib/ops-freshness';
import { useRefetchOnReturn } from '@/lib/hooks/useRefetchOnReturn';
import { GUEST_FLAG_LABEL, type GuestFlag } from '@/lib/ops-flags';
import { mergeTodayConversation, type TodayOverview, type TodayConversation } from '@/lib/ops-today-client';
const CreateMaintenanceModal = dynamic(() => import('@/app/admin/calendar/components/CreateMaintenanceModal').then(m => m.CreateMaintenanceModal));
import type { OpsProperty, OpsReservation } from '@/app/api/ops/today/route';

type OpsData = TodayOverview;

// A same-day snapshot can render while the authoritative read is in progress.
// It is memory-only and never permits actions before that read succeeds.
const snapshotCache = createOpsSnapshotCache<OpsData>(5 * 60_000);
const todayStr = todayKst;
const hhmm = (iso: string) => format(new Date(iso), 'HH:mm');
const stay = (r: OpsReservation) => `${format(parseISO(r.start), 'M/d')}–${format(parseISO(r.end), 'M/d')} · ${r.nights}박`;
const msgTime = (iso: string) => (isToday(new Date(iso)) ? hhmm(iso) : format(new Date(iso), 'M/d HH:mm'));
const chatHref = (r: OpsReservation) => `/admin/messages?eventId=${r.id}&guestName=${encodeURIComponent(r.guestName)}&propertyId=${r.propertyId}`;
const FLAG_TONE: Record<GuestFlag, 'info' | 'warning' | 'brand'> = { early_checkin: 'info', late_checkout: 'warning', request: 'brand' };

/** 게스트 한 명: 이름·투숙·채널 → 태그 → 최근 대화 → 대화 열기 */
function GuestBlock({ r, statusLine, action, loading, error, enabled, onLoad }: {
  r: OpsReservation; statusLine?: React.ReactNode; action?: React.ReactNode;
  loading: boolean; error: string; enabled: boolean; onLoad: (eventId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (enabled && expanded && r.messagesLoaded === false && !loading && !error) onLoad(r.id);
  }, [enabled, expanded, r.id, r.messagesLoaded, loading, error, onLoad]);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="t-body font-semibold text-stone-900">{r.guestName}</span>
        <span className="t-caption text-stone-600">{stay(r)}</span>
        {r.guests ? <span className="t-caption text-stone-500">{r.guests}명</span> : null}
        <span className="t-micro text-stone-500 bg-stone-100 px-1.5 py-0.5">{r.channel}</span>
      </div>
      {r.pets != null && r.pets > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">
          <PawPrint size={18} aria-hidden="true" className="shrink-0" />
          <span className="text-sm font-semibold">강아지 동반 · {r.pets}마리</span>
        </div>
      ) : r.pets === 0 ? (
        <p className="flex items-center gap-1.5 t-caption text-stone-500">
          <PawPrint size={14} aria-hidden="true" />
          강아지 동반 없음
        </p>
      ) : null}
      {statusLine}
      {r.flags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap" title="최근 대화 4개에서 확인된 요청입니다. 전체 내용은 대화 열기에서 확인해 주세요.">
          {r.flags.map(f => <Badge key={f} tone={FLAG_TONE[f]}>{GUEST_FLAG_LABEL[f]}</Badge>)}
        </div>
      )}
      {expanded && (loading || r.messagesLoaded === false && !error ? <p role="status" className="t-caption text-stone-500">최근 대화를 확인하고 있습니다…</p> : error ? (
        <div className="space-y-2"><p role="alert" className="t-caption text-amber-800">{error}</p><Button variant="secondary" size="sm" onClick={() => onLoad(r.id)}>대화 다시 불러오기</Button></div>
      ) : r.messagesAvailable === false ? <p className="t-caption text-amber-800">대화 정보를 확인하지 못했습니다. 대화 열기에서 확인해 주세요.</p> : r.messages.length > 0 ? (
        <div className="bg-stone-50 border border-stone-100 px-3 py-2 space-y-1">
          {r.messages.slice(-3).map(m => (
            <p key={m.id} className="t-caption text-stone-700 line-clamp-2">
              <span className={`t-micro mr-1.5 ${m.sender === 'guest' ? 'text-[var(--brand-dark)]' : 'text-stone-400'}`}>{m.sender === 'guest' ? '게스트' : '호스트'} {msgTime(m.at)}</span>
              {m.text}
            </p>
          ))}
        </div>
      ) : r.hasChat ? (
        <p className="t-caption text-stone-400">주고받은 메시지 없음</p>
      ) : (
        <p className="t-caption text-stone-400">직접 예약 · 채널 대화 없음</p>
      ))}
      <div className="flex gap-2 flex-wrap">
        {r.hasChat && <Button variant="secondary" size="sm" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? '대화 접기' : '최근 대화'}{r.unread > 0 ? ` · 미확인 ${r.unread}` : ''}</Button>}
        {r.hasChat && expanded && (
          <Link href={chatHref(r)} className="inline-flex items-center gap-1.5 min-h-[48px] px-3 border border-stone-300 bg-white t-caption text-stone-800">
            <MessageSquare size={14} /> 대화 열기{r.unread > 0 && <span className="ml-1 min-w-[18px] h-[18px] px-1 bg-[var(--brand)] text-white t-micro flex items-center justify-center">{r.unread}</span>}
          </Link>
        )}
        {action}
      </div>
    </div>
  );
}

export default function OpsPage() {
  const { user, profile } = useAuth();
  const scopeKey = user && profile ? JSON.stringify([user.id, profile.role, profile.status, [...profile.propertyIds].sort()]) : '';
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  const [snapshot, setSnapshot] = useState(() => {
    const cached = snapshotCache.read(scopeKey);
    return { scopeKey, data: cached?.data ?? null, savedAt: cached?.savedAt ?? null };
  });
  // Permission/account changes must not briefly render the previous scope.
  const data = snapshot.scopeKey === scopeKey ? snapshot.data : null;
  const updatedAt = snapshot.scopeKey === scopeKey && snapshot.savedAt != null ? new Date(snapshot.savedAt) : null;
  const mounted = useRef(false);
  const summaryController = useRef<AbortController | null>(null);
  const overviewRevision = useRef(0);
  const lazyControllers = useRef(new Map<string, AbortController>());
  const [conversationReads, setConversationReads] = useState<Record<string, { loading: boolean; error: string }>>({});
  const [cleanersLoading, setCleanersLoading] = useState(false);
  const [cleanersError, setCleanersError] = useState('');
  const [refreshing, setRefreshing] = useState(true);
  const [currentDay, setCurrentDay] = useState(todayKst);
  const [detailsError, setDetailsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [delivery, setDelivery] = useState<Record<string, string>>({});
  const loadingRef = useRef(false);
  const [busy, setBusyState] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const setBusy = useCallback((value: string | null) => { busyRef.current = value; setBusyState(value); }, []);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [cameraFor, setCameraFor] = useState<string | null>(null);
  const [showMaintenance, setShowMaintenance] = useState(false);

  const load = useCallback(async (silent = false, afterMutation = false) => {
    if (!scopeKey || activeScope.current !== scopeKey || busyRef.current && !afterMutation) return;
    if (loadingRef.current) {
      if (!afterMutation) return;
      // A read started before a successful write cannot confirm its result.
      // Discard it and always perform the authoritative post-write read.
      summaryController.current?.abort();
    }
    loadingRef.current = true;
    setRefreshing(true);
    const request = new AbortController();
    summaryController.current = request;
    for (const controller of lazyControllers.current.values()) controller.abort();
    lazyControllers.current.clear();
    setConversationReads({}); setCleanersLoading(false); setCleanersError('');
    if (!silent) setLoading(true);
    try {
      const next = await readOps<OpsData>('/api/ops/today?view=board&includeCounts=false', request.signal);
      if (!mounted.current || request.signal.aborted) return;
      if (next.today !== todayKst()) throw new Error('날짜가 변경되었습니다. 다시 불러와 주세요.');
      overviewRevision.current++;
      snapshotCache.write(scopeKey, next);
      setSnapshot({ scopeKey, data: next, savedAt: Date.now() }); setLoadError(''); setDetailsError(''); setLoading(false);
      setDelivery({});
      if (next.unavailable?.length) setDetailsError('일부 운영 정보를 확인하지 못했습니다. 다시 불러와 주세요.');
    } catch (error) {
      if (!mounted.current || request.signal.aborted) return;
      // Keep a previous same-scope snapshot for display; failed reads remain
      // visibly stale and all operational actions stay blocked.
      setLoadError((error instanceof Error ? error.message : '오늘 현황을 불러오지 못했습니다.') + ' 표시된 자료는 이전 정보일 수 있습니다.');
    } finally {
      if (summaryController.current === request) {
        loadingRef.current = false;
        if (mounted.current) { setLoading(false); setRefreshing(false); }
      }
    }
  }, [scopeKey]);

  useEffect(() => {
    mounted.current = true;
    overviewRevision.current++;
    const lazyRequests = lazyControllers.current;
    const cached = snapshotCache.read(scopeKey);
    setSnapshot({ scopeKey, data: cached?.data ?? null, savedAt: cached?.savedAt ?? null });
    setLoadError(''); setDetailsError('');
    setConversationReads({}); setCleanersLoading(false); setCleanersError(''); setAssign({}); setDelivery({});
    setCameraFor(null); setShowMaintenance(false);
    setBusy(null);
    setLoading(!cached); setRefreshing(true);
    if (scopeKey) void load(!!cached);
    else snapshotCache.clear();
    return () => {
      mounted.current = false; summaryController.current?.abort(); summaryController.current = null;
      for (const controller of lazyRequests.values()) controller.abort();
      lazyRequests.clear();
      loadingRef.current = false;
    };
  }, [scopeKey, load, setBusy]);
  useEffect(() => {
    if (snapshot.scopeKey === scopeKey && snapshot.data && snapshot.savedAt != null) snapshotCache.write(scopeKey, snapshot.data, snapshot.savedAt);
  }, [snapshot, scopeKey]);
  useRefetchOnReturn(() => load(true), { enabled: !!scopeKey });

  const loadConversation = useCallback(async (eventId: string) => {
    const key = `conversation:${eventId}`;
    if (!scopeKey || loadingRef.current || lazyControllers.current.has(key)) return;
    const request = new AbortController(); lazyControllers.current.set(key, request);
    setConversationReads(current => ({ ...current, [eventId]: { loading: true, error: '' } }));
    try {
      const incoming = await readOps<TodayConversation>(`/api/ops/today?view=conversation&eventId=${encodeURIComponent(eventId)}`, request.signal);
      if (!mounted.current || request.signal.aborted || activeScope.current !== scopeKey) return;
      if (incoming.today !== todayKst() || incoming.eventId !== eventId) throw new Error('날짜가 변경되었습니다. 오늘 현황을 다시 불러와 주세요.');
      if (!incoming.messagesAvailable) throw new Error('최근 대화를 확인하지 못했습니다.');
      setSnapshot(current => current.scopeKey === scopeKey && current.data
        ? { ...current, data: mergeTodayConversation(current.data, incoming) } : current);
    } catch (error) {
      if (!mounted.current || request.signal.aborted || activeScope.current !== scopeKey) return;
      setConversationReads(current => ({ ...current, [eventId]: { loading: false, error: error instanceof Error ? error.message : '최근 대화를 불러오지 못했습니다.' } }));
    } finally {
      if (lazyControllers.current.get(key) === request) {
        lazyControllers.current.delete(key);
        if (mounted.current) setConversationReads(current => ({ ...current, [eventId]: { ...current[eventId], loading: false } }));
      }
    }
  }, [scopeKey]);

  const loadCleaners = useCallback(async () => {
    const key = 'assignees';
    if (!scopeKey || loadingRef.current || lazyControllers.current.has(key)) return;
    const request = new AbortController(); lazyControllers.current.set(key, request);
    setCleanersLoading(true); setCleanersError('');
    try {
      const incoming = await readOps<{ today: string; cleaners: OpsData['cleaners']; cleanersLoaded: boolean }>('/api/ops/today?view=assignees', request.signal);
      if (!mounted.current || request.signal.aborted) return;
      if (incoming.today !== todayKst()) throw new Error('날짜가 변경되었습니다. 오늘 현황을 다시 불러와 주세요.');
      if (!incoming.cleanersLoaded) throw new Error('배정 후보를 확인하지 못했습니다.');
      setSnapshot(current => current.scopeKey === scopeKey && current.data?.today === incoming.today
        ? { ...current, data: { ...current.data, cleaners: incoming.cleaners, cleanersLoaded: true } } : current);
    } catch (error) {
      if (!mounted.current || request.signal.aborted) return;
      setCleanersError(error instanceof Error ? error.message : '배정 후보를 불러오지 못했습니다.');
    } finally {
      if (lazyControllers.current.get(key) === request) {
        lazyControllers.current.delete(key);
        if (mounted.current) setCleanersLoading(false);
      }
    }
  }, [scopeKey]);

  useEffect(() => {
    const timer = setInterval(() => {
      const day = todayKst();
      setCurrentDay(day);
      if (data && data.today !== day) void load(true);
    }, 15000);
    return () => clearInterval(timer);
  }, [data, load]);
  const detailsReady = !!data?.detailsLoaded && !data.unavailable?.some(s => ['cleaning', 'checkout', 'cleaners', 'messages'].includes(s));
  const actionsBlocked = opsActionsBlocked({ ...data, refreshing, loadError: !!loadError });
  const actionRevision = overviewRevision.current;
  const actionState = useRef({ blocked: true, date: '', scopeKey: '' });
  actionState.current = { blocked: actionsBlocked, date: data?.today ?? '', scopeKey };
  const canAct = () => {
    if (actionState.current.blocked || actionState.current.date !== todayKst()
      || actionState.current.scopeKey !== scopeKey || overviewRevision.current !== actionRevision) {
      toast.error('최신 운영 정보를 불러온 후 다시 시도해 주세요.');
      return false;
    }
    return true;
  };
  const isCurrentScope = () => mounted.current && activeScope.current === scopeKey;

  const confirmCheckout = async (p: OpsProperty) => {
    if (!canAct()) return;
    if (!(await confirmDialog({ title: `${p.name} 체크아웃 확인`, message: '배정된 청소담당자에게 청소 시작 알림이 갑니다.', confirmLabel: '확인' }))) return;
    if (!canAct()) return;
    snapshotCache.clear();
    setBusy(`checkout:${p.id}`);
    try {
      const res = await fetch('/api/checkout/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: p.id, date: data!.today }) });
      const d = await res.json().catch(() => ({}));
      if (!isCurrentScope()) return;
      if (!res.ok) { toast.error(d.error || '확인에 실패했습니다.'); return; }
      toast.success(d.notified ? `청소담당자 ${d.notified}명에게 알렸습니다.` : '체크아웃을 확인했습니다.');
      await load(true, true);
    } catch { if (isCurrentScope()) toast.error('확인에 실패했습니다.'); } finally { if (isCurrentScope()) setBusy(null); }
  };

  const assignCleaner = async (p: OpsProperty) => {
    if (!canUseOpsModule(p, 'cleaning')) return;
    if (!canAct()) return;
    const cleanerId = assign[p.id];
    if (!cleanerId) return;
    snapshotCache.clear();
    setBusy(`assign:${p.id}`);
    try {
      const res = p.cleaning
        ? await fetch('/api/cleanings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.cleaning.id, cleanerId, status: 'pending', isOpen: false }) })
        : await fetch('/api/cleanings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: p.id, date: data!.today, cleanerId, status: 'pending' }) });
      if (!isCurrentScope()) return;
      if (!res.ok) { const d = await res.json().catch(() => ({})); if (isCurrentScope()) toast.error(d.error || '배정에 실패했습니다.'); return; }
      toast.success(`${data?.cleaners.find(c => c.id === cleanerId)?.name ?? '담당자'}에게 배정했습니다.`);
      await load(true, true);
    } catch { if (isCurrentScope()) toast.error('배정에 실패했습니다.'); } finally { if (isCurrentScope()) setBusy(null); }
  };

  /** 청소 완료: 청소 행을 done 으로, 오늘 체크인 게스트(Beds24)가 있으면 청소 완료 안내. 캘린더와 같은 순서. */
  const completeCleaning = async (p: OpsProperty) => {
    if (!canUseOpsModule(p, 'cleaning')) return;
    if (!canAct()) return;
    if (!needsOpsCleaning(p)) { toast.error('청소 일정이 없는 날입니다. 입실 안내에서 메시지를 보내 주세요.'); return; }
    const checkin = p.checkins.find(r => r.hasChat) ?? p.checkins[0];
    const msg = checkin?.hasChat && p.canSendMessages !== false
      ? `${p.name} 청소를 완료로 기록하고, 오늘 체크인 게스트(${checkin.guestName})에게 청소 완료 안내를 보냅니다.`
      : `${p.name} 청소를 완료로 기록합니다.`;
    if (!(await confirmDialog({ title: '청소 완료', message: msg, confirmLabel: '완료' }))) return;
    if (!canAct()) return;
    snapshotCache.clear();
    setBusy(`done:${p.id}`);
    try {
      const res = p.cleaning
        ? await fetch('/api/cleanings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.cleaning.id, status: 'done', completedAt: new Date().toISOString() }) })
        : await fetch('/api/cleanings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: p.id, date: data!.today, status: 'done' }) });
      if (!isCurrentScope()) return;
      if (!res.ok) { const d = await res.json().catch(() => ({})); if (isCurrentScope()) toast.error(d.error || '청소 완료 처리에 실패했습니다.'); return; }
      if (checkin?.hasChat && p.canSendMessages !== false) await sendReady(p, checkin, true);
      else toast.success('청소 완료로 기록했습니다.');
      await load(true, true);
    } catch { if (isCurrentScope()) toast.error('청소 완료 처리에 실패했습니다.'); } finally { if (isCurrentScope()) setBusy(null); }
  };

  const sendReady = async (p: OpsProperty, checkin: OpsReservation, alreadyConfirmed = false) => {
    if (!canUseOpsModule(p, 'messages') || p.canSendMessages === false) return;
    if (!canAct()) return;
    if (!alreadyConfirmed && !(await confirmDialog({ title: `${p.name} 입실 안내`, message: `${checkin.guestName}님께 ${checkin.channel} 대화로 아래 안내를 보냅니다. 객실 준비 상태를 확인해 주세요.\n\n${p.readyMessage}`, confirmLabel: '안내 보내기' }))) return;
    if (!canAct()) return;
    setDelivery(prev => ({ ...prev, [checkin.id]: 'sending' }));
    snapshotCache.clear();
    setBusy('message:' + p.id);
    try {
      const res = await fetch('/api/beds24/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: checkin.id, propertyId: p.id, text: p.readyMessage }) });
      const result = await res.json();
      if (!isCurrentScope()) return;
      if (!res.ok || result.deliveryStatus !== 'sent') throw new Error('전송 결과를 확인하지 못했습니다. 대화에서 확인 후 다시 보내 주세요.');
      setDelivery(prev => ({ ...prev, [checkin.id]: 'sent' }));
    } catch (err) {
      if (isCurrentScope()) setDelivery(prev => ({ ...prev, [checkin.id]: err instanceof Error ? err.message : '안내 전송에 실패했습니다.' }));
    } finally { if (isCurrentScope()) setBusy(null); }
  };

  const cameraProperties = (data?.properties ?? []).filter(p => canUseOpsModule(p, 'guestServices'));
  const maintenanceProperties = (data?.properties ?? []).filter(p => p.canCreateMaintenance !== false);
  return (
    <PullToRefresh onRefresh={() => load(true)}>
      <TodayBoard
        data={data} loading={loading || snapshot.scopeKey !== scopeKey} refreshing={refreshing} updatedAt={updatedAt}
        loadError={snapshot.scopeKey === scopeKey ? loadError : ''}
        detailsError={(snapshot.scopeKey === scopeKey ? detailsError : '') || (data && data.today !== currentDay ? '날짜가 변경되어 최신 정보를 확인하고 있습니다.' : '')}
        detailsReady={detailsReady} actionsBlocked={actionsBlocked} busy={busy}
        delivery={delivery} assign={assign}
        cleanersLoading={cleanersLoading} cleanersError={cleanersError} onLoadCleaners={loadCleaners}
        onRefresh={() => { void load(!!data); }}
        onAssignChange={(propertyId, cleanerId) => setAssign(prev => ({ ...prev, [propertyId]: cleanerId }))}
        onAssign={p => { void assignCleaner(p); }} onCheckout={p => { void confirmCheckout(p); }}
        onComplete={p => { void completeCleaning(p); }} onSendReady={(p, r) => { void sendReady(p, r); }}
        onCamera={setCameraFor} onMaintenance={() => setShowMaintenance(true)}
        renderGuest={(r, statusLine, action) => <GuestBlock r={r} statusLine={statusLine} action={action} loading={conversationReads[r.id]?.loading ?? false} error={conversationReads[r.id]?.error ?? ''} enabled={!refreshing && !loadError} onLoad={loadConversation} />}
      />
        <CameraSheet key={`${scopeKey}:${currentDay}`} propertyId={snapshot.scopeKey === scopeKey ? cameraFor : null} properties={cameraProperties} onSelect={setCameraFor} onClose={() => setCameraFor(null)} />
        {showMaintenance && maintenanceProperties.length > 0 && snapshot.scopeKey === scopeKey && <CreateMaintenanceModal key={scopeKey} properties={maintenanceProperties} onClose={() => setShowMaintenance(false)} onCreated={() => { if (!isCurrentScope()) return; setShowMaintenance(false); toast.success('객실정비를 등록했습니다.'); void load(true, true); }} />}
    </PullToRefresh>
  );
}

/** 지점 카메라 시트 — 오늘 사진 격자, 지점 칩으로 바로 전환, 전체 보기 링크 */
function CameraSheet({ propertyId, properties, onSelect, onClose }: {
  propertyId: string | null; properties: { id: string; name: string }[]; onSelect: (id: string) => void; onClose: () => void;
}) {
  type Shot = { id: string; capturedAt: string; url: string | null; leaving: boolean; verdict: { summary?: string } | null };
  const [cameraError, setCameraError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; shots: Shot[] } | null>(null);
  const [hasHistory, setHasHistory] = useState(false);
  const [diagnostic, setDiagnostic] = useState<{ id: string; message: string } | null>(null);
  const loading = !!propertyId && loaded?.id !== propertyId;
  const shots = loaded?.id === propertyId ? loaded.shots : [];

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    fetch(`/api/camera/snapshots?propertyId=${propertyId}&date=${todayStr()}`)
      .then(r => { if (!r.ok) throw new Error('사진을 불러오지 못했습니다.'); return r.json(); })
      .then(async d => {
        if (cancelled) return;
        setDiagnostic(null);
        setLoaded({ id: propertyId, shots: d.snapshots ?? [] }); setHasHistory((d.dates ?? []).length > 0); setCameraError('');
        if (!(d.dates ?? []).length) {
          // Load connection diagnostics only when an opened camera has no history.
          const response = await fetch(`/api/camera/diagnostics?propertyId=${encodeURIComponent(propertyId)}`).catch(() => null);
          if (!response?.ok || cancelled) return;
          const status = await response.json().catch(() => null);
          if (!cancelled && typeof status?.message === 'string') setDiagnostic({ id: propertyId, message: status.message });
        }
      })
      .catch(() => { if (!cancelled) { setCameraError('사진을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.'); setLoaded({ id: propertyId, shots: [] }); } });
    return () => { cancelled = true; };
  }, [propertyId, retry]);

  const name = properties.find(p => p.id === propertyId)?.name ?? '';
  return (
    <Sheet open={!!propertyId} onClose={onClose} title={`${name} 복도 카메라`} description="오늘 감지된 사진입니다. 사진을 누르면 크게 보입니다." size="lg">
      <div className="flex gap-1.5 overflow-x-auto pb-3">
        {properties.map(p => (
          <button key={p.id} type="button" onClick={() => onSelect(p.id)} className={`shrink-0 px-3 min-h-[48px] t-caption border ${p.id === propertyId ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-600 border-stone-200'}`}>
            {p.name}
          </button>
        ))}
      </div>
      {shots.some(s => !s.url) && <p role="status" className="text-sm text-amber-800">일부 사진의 주소를 불러오지 못했습니다. 다시 열어 확인해 주세요.</p>}
      {diagnostic?.id === propertyId && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-stone-700">{diagnostic?.message}</p>}
      {loading ? (
        <SkeletonList count={1} rows={2} />
      ) : cameraError ? (<div role="alert" className="p-4 space-y-3"><p>{cameraError}</p><Button variant="secondary" onClick={() => { setLoaded(null); setCameraError(''); setRetry(v => v + 1); }}>다시 불러오기</Button></div>) : shots.length === 0 ? (
        <p className="t-caption text-stone-500 py-6 text-center">{hasHistory ? '오늘 저장된 사진이 없습니다. 다른 날짜 보기를 확인해 주세요.' : '저장된 카메라 사진이 아직 없습니다. 카메라의 사진 메일 발송, 메일함 수신 설정, 숙소 연결을 확인해 주세요.'} 사진이 없다는 것만으로 퇴실 여부를 판단할 수 없습니다.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {shots.map(s => (
            <a key={s.id} href={s.url ?? '#'} target="_blank" rel="noreferrer" className={`block border ${s.leaving ? 'border-amber-400' : 'border-stone-200'}`}>
              {s.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.url} alt={`복도 ${hhmm(s.capturedAt)}`} className="w-full aspect-[4/3] object-cover bg-stone-100" loading="lazy" />
              ) : <div className="w-full aspect-[4/3] bg-stone-100 grid place-items-center text-xs text-stone-600">사진 주소 확인 필요</div>}
              <div className="px-2 py-1.5 flex items-center justify-between gap-1">
                <span className="t-caption tabular-nums">{format(parseISO(s.capturedAt), 'HH:mm:ss')}</span>
                {s.leaving && <Badge tone="warning">퇴실로 보임</Badge>}
              </div>
              {s.verdict?.summary && <p className="px-2 pb-2 t-micro text-stone-500 line-clamp-2">{s.verdict.summary}</p>}
            </a>
          ))}
        </div>
      )}
      {propertyId && (
        <Link href={`/admin/properties/${propertyId}/camera`} className="mt-4 inline-flex items-center gap-1.5 t-caption text-stone-600 hover:text-stone-900">
          <ExternalLink size={14} /> 다른 날짜 보기
        </Link>
      )}
    </Sheet>
  );
}
