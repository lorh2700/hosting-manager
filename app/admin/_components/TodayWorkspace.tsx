'use client';

/**
 * 정비 허브 — 정보가 먼저, 버튼은 그 아래.
 *  1. 오늘 운영하는 지점 요약
 *  2. 지점 카드: 체크아웃 게스트(투숙 일자, 퇴실 여부, 레이트 체크아웃 문의, 최근 대화)
 *               체크인 게스트(투숙 일자, 인원, 채널, 얼리 체크인·요청사항, 최근 대화)
 *               청소 배정 · 청소 완료
 *  3. 처리할 것 · 바로가기
 * 운영 현황을 먼저 표시하고 카메라 사진은 별도로 불러온다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { format, parseISO, isToday } from 'date-fns';
import { ko } from 'date-fns/locale';
import { PawPrint, Camera, Check, ChevronRight, Hand, AlertTriangle, Package, Users, FileBarChart, Wrench, ExternalLink, MessageSquare, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Logo } from '@/components/Logo';
import { Badge, Button, Card, EmptyState, PageHeader, Select, Sheet, SkeletonList, PullToRefresh, toast, confirmDialog } from '@/components/ui';
import { todayKst } from '@/lib/dates';
import { readOps } from '@/lib/read-ops';
import { createOpsSnapshotCache } from '@/lib/ops-loading';
import { opsActionsBlocked } from '@/lib/ops-freshness';
import { useRefetchOnReturn } from '@/lib/hooks/useRefetchOnReturn';
import { GUEST_FLAG_LABEL, type GuestFlag } from '@/lib/ops-flags';
const CreateMaintenanceModal = dynamic(() => import('@/app/admin/calendar/components/CreateMaintenanceModal').then(m => m.CreateMaintenanceModal));
import type { OpsProperty, OpsReservation } from '@/app/api/ops/today/route';

interface OpsData {
  today: string;
  detailsLoaded?: boolean;
  unavailable?: string[];
  properties: OpsProperty[];
  cleaners: { id: string; name: string }[];
  counts: { pendingApplications: number | null; openIssues: number | null; pendingSupplies: number | null };
}

const snapshotCache = createOpsSnapshotCache<OpsData>();
const todayStr = todayKst;
const hhmm = (iso: string) => format(new Date(iso), 'HH:mm');
const stay = (r: OpsReservation) => `${format(parseISO(r.start), 'M/d')}–${format(parseISO(r.end), 'M/d')} · ${r.nights}박`;
const msgTime = (iso: string) => (isToday(new Date(iso)) ? hhmm(iso) : format(new Date(iso), 'M/d HH:mm'));
const chatHref = (r: OpsReservation) => `/admin/messages?eventId=${r.id}&guestName=${encodeURIComponent(r.guestName)}&propertyId=${r.propertyId}`;
const FLAG_TONE: Record<GuestFlag, 'info' | 'warning' | 'brand'> = { early_checkin: 'info', late_checkout: 'warning', request: 'brand' };

/** 게스트 한 명: 이름·투숙·채널 → 태그 → 최근 대화 → 대화 열기 */
function GuestBlock({ r, statusLine, action }: { r: OpsReservation; statusLine?: React.ReactNode; action?: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
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
      {expanded && (r.messagesAvailable === false ? <p className="t-caption text-amber-800">대화 정보를 확인하지 못했습니다. 대화 열기에서 확인해 주세요.</p> : r.messages.length > 0 ? (
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
  const [data, setData] = useState<OpsData | null>(null);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const mediaController = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const summaryController = useRef<AbortController | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [currentDay, setCurrentDay] = useState(todayKst);
  const [detailsError, setDetailsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState<'all' | 'attention' | 'done'>('all');
  const [delivery, setDelivery] = useState<Record<string, string>>({});
  const loadingRef = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [cameraFor, setCameraFor] = useState<string | null>(null);
  const [showMaintenance, setShowMaintenance] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setRefreshing(true);
    const request = new AbortController();
    summaryController.current = request;
    if (!silent) setLoading(true);
    try {
      mediaController.current?.abort();
      setCameraLoading(true); setCameraError('');
      let next = await readOps<OpsData>('/api/ops/today?view=summary', request.signal);
      if (!mounted.current || request.signal.aborted) return;
      if (next.today !== todayKst()) throw new Error('날짜가 변경되었습니다. 다시 불러와 주세요.');
      snapshotCache.write(scopeKey, next);
      setData(next); setUpdatedAt(new Date()); setLoadError(''); setDetailsError(''); setLoading(false);
      setDelivery({});
      try {
        const includeCounts = window.matchMedia('(min-width: 640px)').matches;
        const detail = await readOps<OpsData>(`/api/ops/today?view=details&includeCounts=${includeCounts}`, request.signal);
        if (request.signal.aborted || !mounted.current) return;
        if (detail.today !== next.today || detail.today !== todayKst()) throw new Error('날짜가 변경되었습니다. 다시 불러와 주세요.');
        next = detail;
        snapshotCache.write(scopeKey, detail);
        setData(detail);
        if (detail.unavailable?.length) setDetailsError('일부 운영 정보를 확인하지 못했습니다. 다시 불러와 주세요.');
      } catch (error) {
        if (request.signal.aborted || !mounted.current) return;
        setDetailsError(error instanceof Error ? error.message : '운영 정보를 불러오지 못했습니다.');
      }
      // Render core cards now; photo signing/storage is a separate request.
      const controller = new AbortController();
      mediaController.current = controller;
      void readOps<{ today: string; properties: Pick<OpsProperty, 'id' | 'camera'>[] }>('/api/ops/today?view=cameras', controller.signal)
        .then(media => {
          if (controller.signal.aborted) return;
          if (media.today !== next.today) throw new Error('날짜가 변경되었습니다. 새로고침해주세요.');
          const byId = new Map(media.properties.map(p => [p.id, p.camera]));
          setData(current => current === next ? { ...current, properties: current.properties.map(p => ({ ...p, camera: byId.get(p.id) ?? [] })) } : current);
        }).catch(() => { if (!controller.signal.aborted) setCameraError('카메라 사진을 불러오지 못했습니다. 복도 카메라에서 다시 확인해주세요.'); })
        .finally(() => { if (!controller.signal.aborted) setCameraLoading(false); });
    } catch (error) {
      if (!mounted.current || request.signal.aborted) return;
      snapshotCache.clear();
      setCameraLoading(false);
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
    const cached = snapshotCache.read(scopeKey);
    setData(cached?.data ?? null);
    setUpdatedAt(cached ? new Date(cached.savedAt) : null);
    setLoadError(''); setDetailsError('');
    setLoading(!cached); setRefreshing(true);
    if (scopeKey) void load(!!cached);
    else snapshotCache.clear();
    return () => {
      mounted.current = false; summaryController.current?.abort(); summaryController.current = null;
      loadingRef.current = false; mediaController.current?.abort();
    };
  }, [scopeKey, load]);
  useRefetchOnReturn(() => load(true));
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 640px)');
    const onChange = () => { if (desktop.matches) void load(true); };
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, [load]);

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
  const actionState = useRef<{ blocked: boolean; date: string; data: OpsData | null }>({ blocked: true, date: '', data: null });
  actionState.current = { blocked: actionsBlocked, date: data?.today ?? '', data };
  const canAct = () => {
    if (actionState.current.blocked || actionState.current.date !== todayKst() || actionState.current.data !== data) {
      toast.error('최신 운영 정보를 불러온 후 다시 시도해 주세요.');
      return false;
    }
    return true;
  };

  const working = useMemo(() => (data?.properties ?? []).filter(p => p.hasWork).sort((a, b) => Number(a.cleaning?.status === 'done') - Number(b.cleaning?.status === 'done')), [data]);
  const visibleWorking = working.filter(p => filter === 'all' || (filter === 'done' ? p.cleaning?.status === 'done' : p.cleaning?.status !== 'done'));
  const idle = useMemo(() => (data?.properties ?? []).filter(p => !p.hasWork), [data]);
  const totals = useMemo(() => ({
    checkins: working.reduce((n, p) => n + p.checkins.length, 0),
    checkouts: working.reduce((n, p) => n + p.checkouts.length, 0),
    cleanings: working.filter(p => p.cleaning).length,
  }), [working]);

  const confirmCheckout = async (p: OpsProperty) => {
    if (!canAct()) return;
    if (!(await confirmDialog({ title: `${p.name} 체크아웃 확인`, message: '배정된 청소담당자에게 청소 시작 알림이 갑니다.', confirmLabel: '확인' }))) return;
    if (!canAct()) return;
    snapshotCache.clear();
    setBusy(`checkout:${p.id}`);
    try {
      const res = await fetch('/api/checkout/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: p.id, date: data!.today }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || '확인에 실패했습니다.'); return; }
      toast.success(d.notified ? `청소담당자 ${d.notified}명에게 알렸습니다.` : '체크아웃을 확인했습니다.');
      await load(true);
    } catch { toast.error('확인에 실패했습니다.'); } finally { setBusy(null); }
  };

  const assignCleaner = async (p: OpsProperty) => {
    if (!canAct()) return;
    const cleanerId = assign[p.id];
    if (!cleanerId) return;
    snapshotCache.clear();
    setBusy(`assign:${p.id}`);
    try {
      const res = p.cleaning
        ? await fetch('/api/cleanings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.cleaning.id, cleanerId, status: 'pending', isOpen: false }) })
        : await fetch('/api/cleanings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: p.id, date: data!.today, cleanerId, status: 'pending' }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || '배정에 실패했습니다.'); return; }
      toast.success(`${data?.cleaners.find(c => c.id === cleanerId)?.name ?? '담당자'}에게 배정했습니다.`);
      await load(true);
    } catch { toast.error('배정에 실패했습니다.'); } finally { setBusy(null); }
  };

  /** 청소 완료: 청소 행을 done 으로, 오늘 체크인 게스트(Beds24)가 있으면 청소 완료 안내. 캘린더와 같은 순서. */
  const completeCleaning = async (p: OpsProperty) => {
    if (!canAct()) return;
    const checkin = p.checkins.find(r => r.hasChat) ?? p.checkins[0];
    const msg = checkin?.hasChat
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
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || '청소 완료 처리에 실패했습니다.'); return; }
      if (checkin?.hasChat) await sendReady(p, checkin);
      else toast.success('청소 완료로 기록했습니다.');
      await load(true);
    } catch { toast.error('청소 완료 처리에 실패했습니다.'); } finally { setBusy(null); }
  };

  const sendReady = async (p: OpsProperty, checkin: OpsReservation) => {
    if (!canAct()) return;
    setDelivery(prev => ({ ...prev, [checkin.id]: 'sending' }));
    snapshotCache.clear();
    setBusy('message:' + p.id);
    try {
      const res = await fetch('/api/beds24/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: checkin.id, propertyId: p.id, text: p.readyMessage }) });
      const result = await res.json();
      if (!res.ok || result.deliveryStatus !== 'sent') throw new Error('전송 결과를 확인하지 못했습니다. 대화에서 확인 후 다시 보내 주세요.');
      setDelivery(prev => ({ ...prev, [checkin.id]: 'sent' }));
    } catch (err) {
      setDelivery(prev => ({ ...prev, [checkin.id]: err instanceof Error ? err.message : '안내 전송에 실패했습니다.' }));
    } finally { setBusy(null); }
  };

  const allProps = (data?.properties ?? []).map(p => ({ id: p.id, name: p.name }));

  return (
    <PullToRefresh onRefresh={() => load(true)}>
      <div className="max-w-4xl mx-auto space-y-6 pb-nav">
        <PageHeader eyebrow="void anchae · 숙소 운영" title="오늘" description={format(new Date(), 'M월 d일 (EEE)', { locale: ko })} />

        {updatedAt && <p className="text-xs text-stone-500" role="status">마지막 확인 {format(updatedAt, 'M/d HH:mm')} · {refreshing ? '최신 정보 확인 중…' : '아래로 당겨 새로고침'}</p>}
        {loadError && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3"><p className="text-sm text-stone-800">{loadError}</p><Button variant="secondary" onClick={() => load(!data ? false : true)}>다시 불러오기</Button></div>}
        {(detailsError || (data && data.today !== currentDay)) && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4"><p>{detailsError || '날짜가 변경되어 최신 정보를 확인하고 있습니다.'}</p><Button variant="secondary" disabled={refreshing} onClick={() => load(true)}>다시 불러오기</Button></div>}
        {data && !data.detailsLoaded && !detailsError && <p role="status">예약 목록을 불러왔습니다. 청소·대화 정보를 확인하고 있습니다.</p>}
        {loading ? (
          <div role="status" aria-live="polite" aria-label="오늘 일정을 불러오는 중" className="flex min-h-[320px] flex-col items-center justify-center gap-7 rounded-2xl border border-stone-200 bg-stone-50/70 px-6 py-12 sm:min-h-[380px]">
            <div className="relative flex h-20 w-20 items-center justify-center" aria-hidden="true">
              <div className="absolute inset-0 rounded-full border-2 border-stone-200" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[var(--brand)] motion-safe:animate-spin" />
              <span className="h-3 w-3 rounded-full bg-[var(--brand)]/70 motion-safe:animate-pulse" />
            </div>
            <Logo variant="black" width={170} />
            <div className="text-center space-y-2">
              <p className="text-base font-medium text-stone-800">오늘 일정을 불러오고 있어요</p>
              <p className="text-sm text-stone-500">체크인·체크아웃 정보를 확인하고 있습니다.</p>
            </div>
          </div>
        ) : data ? (
          <>
            {/* 1. 오늘 요약 */}
            <div className="bg-white border border-stone-200 px-4 py-3">
              {working.length === 0 ? (
                <p className="t-body text-stone-500">오늘은 정비할 지점이 없습니다.</p>
              ) : (
                <>
                  <p className="t-body text-stone-900">
                    오늘 정비 <span className="font-semibold">{working.length}곳</span>
                    <span className="text-stone-500"> · 체크인 {totals.checkins} · 체크아웃 {totals.checkouts}</span>
                  </p>
                  <p className="t-caption text-stone-600 mt-1">{working.map(p => p.name).join(' · ')}</p>
                </>
              )}
            </div>

            <div className="flex gap-2" aria-label="오늘 숙소 필터">
              {(['all', 'attention', 'done'] as const).map(f => <Button key={f} variant={filter === f ? 'primary' : 'secondary'} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? '전체' : f === 'attention' ? '처리할 숙소' : '청소 완료'}</Button>)}
            </div>
            {working.length > 0 && visibleWorking.length === 0 && <p className="p-5 text-stone-600">이 조건에 해당하는 숙소가 없습니다.</p>}
            {/* 2. 지점 카드 */}
            {visibleWorking.map(p => {
              const cleaningDone = p.cleaning?.status === 'done';
              const leaving = p.camera.find(s => s.leaving);
              const co = p.checkoutStatus;
              return (
                <Card key={p.id} padded={false} className="rounded-2xl overflow-hidden shadow-sm">
                  <div className="px-4 py-3 flex items-center gap-2 border-b border-stone-200 bg-stone-50">
                    <span className="text-xl font-semibold text-stone-900">{p.name}</span>
                    {!detailsReady ? <Badge tone="warning">운영 정보 확인 필요</Badge> : cleaningDone ? <Badge tone="success"><Check size={12} /> 청소 완료</Badge>
                      : p.cleaning?.cleanerName ? <Badge tone="brand">청소 · {p.cleaning.cleanerName}</Badge>
                      : (p.checkouts.length > 0 || p.cleaning) ? <Badge tone="danger">청소 미배정</Badge> : null}
                    <button type="button" onClick={() => setCameraFor(p.id)} className="ml-auto tap flex items-center justify-center text-stone-500 hover:text-stone-900" aria-label={`${p.name} 복도 카메라`}>
                      <Camera size={20} />
                    </button>
                  </div>

                  <div className="px-4 py-4 space-y-5">
                    {/* 체크인 */}
                    {p.checkins.length > 0 && (
                      <section className="space-y-3">
                        <p className="t-label text-emerald-700 flex items-center gap-1"><ArrowDownRight size={13} /> 체크인</p>
                        {p.checkins.map(r => <GuestBlock key={r.id} r={r} />)}
                      </section>
                    )}

                    {/* 체크아웃 */}
                    {p.checkouts.length > 0 && (
                      <section className="space-y-3">
                        <p className="t-label text-amber-700 flex items-center gap-1"><ArrowUpRight size={13} /> 체크아웃</p>
                        {p.checkouts.map(r => (
                          <GuestBlock
                            key={r.id}
                            r={r}
                            statusLine={
                              !detailsReady ? (<p className="t-caption text-amber-800">퇴실 상태 확인 필요</p>) : co?.confirmed ? (
                                <p className="t-caption text-emerald-700 flex items-center gap-1"><Check size={13} /> {co.confirmedBy === 'guest_pad' ? '게스트가 패드에서 체크아웃' : '체크아웃 확인'} {co.confirmedAt && hhmm(co.confirmedAt)}</p>
                              ) : leaving ? (
                                <p className="t-caption text-amber-700">카메라 {hhmm(leaving.capturedAt)} 퇴실로 보임{leaving.summary ? ` · ${leaving.summary}` : ''}</p>
                              ) : (
                                <p className="t-caption text-stone-500">아직 체크아웃 확인 전{p.camera.length > 0 ? ` · 카메라 ${p.camera.length}장, 퇴실 판정 없음` : ''}</p>
                              )
                            }
                            action={!co?.confirmed && <Button disabled={!!busy || actionsBlocked} size="sm" onClick={() => confirmCheckout(p)} loading={busy === `checkout:${p.id}`}>체크아웃 확인</Button>}
                          />
                        ))}
                        {p.camera.length > 0 && (
                          <div className="flex gap-1.5 overflow-x-auto">
                            {p.camera.map(s => s.url ? (
                              <button key={s.id} type="button" onClick={() => setCameraFor(p.id)} className={`relative shrink-0 border ${s.leaving ? 'border-amber-400' : 'border-stone-200'}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={s.url} alt={`복도 ${hhmm(s.capturedAt)}`} className="h-14 w-20 object-cover" />
                                <span className="absolute bottom-0 right-0 bg-black/60 text-white t-micro px-1">{hhmm(s.capturedAt)}</span>
                              </button>
                            ) : null)}
                          </div>
                        )}
                      </section>
                    )}

                    {/* 청소 */}
                    <section className="space-y-3 border-t border-stone-100 pt-3">
                      <p className="t-label text-stone-500">청소</p>
                      {(p.cleaning?.supplies || p.cleaning?.notes) && (
                        <p className="t-caption text-stone-600">{[p.cleaning?.supplies, p.cleaning?.notes].filter(Boolean).join(' · ')}</p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        {cleaningDone ? (
                          <span className="t-caption text-emerald-700">청소 완료{p.cleaning?.cleanerName ? ` · ${p.cleaning.cleanerName}` : ''}</span>
                        ) : p.cleaning?.cleanerName ? (
                          <span className="t-caption text-stone-700">{p.cleaning.cleanerName} 배정됨</span>
                        ) : (
                          <>
                            <Select value={assign[p.id] ?? ''} onChange={e => setAssign(prev => ({ ...prev, [p.id]: e.target.value }))} className="!w-auto min-w-[150px] !min-h-[36px] !text-[14px]">
                              <option value="">담당자 선택</option>
                              {data.cleaners.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </Select>
                            <Button size="sm" variant="secondary" onClick={() => assignCleaner(p)} disabled={!assign[p.id] || !!busy || actionsBlocked} loading={busy === `assign:${p.id}`}>배정</Button>
                          </>
                        )}
                        {!cleaningDone && (
                          <Button className="w-full mt-2" disabled={!!busy || actionsBlocked} onClick={() => completeCleaning(p)} loading={busy === `done:${p.id}`}>청소 완료</Button>
                        )}
                      </div>
                    </section>
                    {p.checkins.filter(r => r.hasChat).map(r => {
                      const status = delivery[r.id] ?? r.readyDelivery;
                      return cleaningDone || status ? <div key={r.id} className="rounded-xl border border-stone-200 p-3 text-sm space-y-2" role="status"><p>{r.guestName} 입실 안내 · {status === 'sent' ? '전송됨' : status === 'sending' ? '전송 중' : status === 'failed' ? '전송 실패' : status || '전송 기록을 확인해 주세요'}</p>{status !== 'sent' && <Button variant="secondary" disabled={!!busy || actionsBlocked} onClick={() => sendReady(p, r)}>입실 안내 보내기</Button>}</div> : null;
                    })}
                  </div>
                </Card>
              );
            })}

            {idle.length > 0 && (
              <p className="t-caption text-stone-400">
                오늘 일정 없음: {idle.map(p => (
                  <button key={p.id} type="button" onClick={() => setCameraFor(p.id)} className="underline underline-offset-2 mr-2">{p.name}</button>
                ))}
              </p>
            )}

            {/* 3. 처리할 것 · 바로가기 */}
            <div className="hidden sm:grid grid-cols-3 gap-2">
              {[
                { href: '/admin/cleaning-requests', label: '청소 신청', count: data.counts.pendingApplications, icon: Hand },
                { href: '/admin/issues', label: '이슈', count: data.counts.openIssues, icon: AlertTriangle },
                { href: '/admin/supplies', label: '비품 요청', count: data.counts.pendingSupplies, icon: Package },
              ].map(t => (
                <Link key={t.href} href={t.href} className={`bg-white border p-3 flex flex-col gap-1 ${(t.count ?? 0) > 0 ? 'border-amber-300' : 'border-stone-200'}`}>
                  <span className="flex items-center gap-1.5 t-micro text-stone-500"><t.icon size={13} /> {t.label}</span>
                  <span className={`t-title ${(t.count ?? 0) > 0 ? 'text-amber-700' : 'text-stone-400'}`}>{t.count ?? '확인 필요'}<span className="t-caption font-normal ml-0.5">건</span></span>
                </Link>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Link href="/admin/staff" className="bg-white border border-stone-200 p-3 flex items-center gap-2 t-caption text-stone-700"><Users size={15} /> 청소 담당자 <ChevronRight size={14} className="ml-auto text-stone-400" /></Link>
              <Link href="/admin/cleaning-report" className="bg-white border border-stone-200 p-3 flex items-center gap-2 t-caption text-stone-700"><FileBarChart size={15} /> 청소 보고서 <ChevronRight size={14} className="ml-auto text-stone-400" /></Link>
              <button type="button" onClick={() => setShowMaintenance(true)} className="bg-white border border-stone-200 p-3 flex items-center gap-2 t-caption text-stone-700 text-left"><Wrench size={15} /> 유지보수 등록 <ChevronRight size={14} className="ml-auto text-stone-400" /></button>
            </div>
          </>
        ) : null}

        {cameraLoading && !loading && <p role="status" className="t-caption text-stone-500">카메라 사진을 불러오는 중…</p>}
        {cameraError && <p role="status" className="t-caption text-amber-700">{cameraError}</p>}
        {data?.properties.length === 0 && !loading && <EmptyState icon={Wrench} title="관리하는 숙소가 없습니다" />}

        <CameraSheet propertyId={cameraFor} properties={allProps} onSelect={setCameraFor} onClose={() => setCameraFor(null)} />

        {showMaintenance && (
          <CreateMaintenanceModal
            properties={allProps}
            onClose={() => setShowMaintenance(false)}
            onCreated={() => { setShowMaintenance(false); toast.success('객실정비를 등록했습니다.'); load(true); }}
          />
        )}
      </div>
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
  const loading = !!propertyId && loaded?.id !== propertyId;
  const shots = loaded?.id === propertyId ? loaded.shots : [];

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    fetch(`/api/camera/snapshots?propertyId=${propertyId}&date=${todayStr()}`)
      .then(r => { if (!r.ok) throw new Error('사진을 불러오지 못했습니다.'); return r.json(); })
      .then(d => { if (!cancelled) { setLoaded({ id: propertyId, shots: d.snapshots ?? [] }); setCameraError(''); } })
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
      {loading ? (
        <SkeletonList count={1} rows={2} />
      ) : cameraError ? (<div role="alert" className="p-4 space-y-3"><p>{cameraError}</p><Button variant="secondary" onClick={() => { setLoaded(null); setCameraError(''); setRetry(v => v + 1); }}>다시 불러오기</Button></div>) : shots.length === 0 ? (
        <p className="t-caption text-stone-500 py-6 text-center">오늘 저장된 사진이 없습니다. 사진이 없다는 것만으로 퇴실 여부를 판단할 수 없습니다.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {shots.map(s => (
            <a key={s.id} href={s.url ?? '#'} target="_blank" rel="noreferrer" className={`block border ${s.leaving ? 'border-amber-400' : 'border-stone-200'}`}>
              {s.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.url} alt={`복도 ${hhmm(s.capturedAt)}`} className="w-full aspect-[4/3] object-cover bg-stone-100" loading="lazy" />
              ) : <div className="w-full aspect-[4/3] bg-stone-100" />}
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
