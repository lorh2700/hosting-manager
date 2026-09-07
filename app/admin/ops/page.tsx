'use client';

/**
 * 정비 허브 — 정보가 먼저, 버튼은 그 아래.
 *  1. 오늘 정비하는 지점 요약
 *  2. 지점 카드: 체크아웃 게스트(투숙 일자, 퇴실 여부, 레이트 체크아웃 문의, 최근 대화)
 *               체크인 게스트(투숙 일자, 인원, 채널, 얼리 체크인·요청사항, 최근 대화)
 *               청소 배정 · 정비 완료
 *  3. 처리할 것 · 바로가기
 * 데이터는 /api/ops/today 한 번.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format, parseISO, isToday } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Camera, Check, ChevronRight, Hand, AlertTriangle, Package, Users, FileBarChart, Wrench, ExternalLink, MessageSquare, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Badge, Button, Card, EmptyState, PageHeader, Select, Sheet, SkeletonList, PullToRefresh, toast, confirmDialog } from '@/components/ui';
import { useRefetchOnReturn } from '@/lib/hooks/useRefetchOnReturn';
import { GUEST_FLAG_LABEL, type GuestFlag } from '@/lib/ops-flags';
import { getRoomReadyMessage, type Property as CalendarProperty } from '@/app/admin/calendar/types';
import { CreateMaintenanceModal } from '@/app/admin/calendar/components/CreateMaintenanceModal';
import type { OpsProperty, OpsReservation } from '@/app/api/ops/today/route';

interface OpsData {
  today: string;
  properties: OpsProperty[];
  cleaners: { id: string; name: string }[];
  counts: { pendingApplications: number; openIssues: number; pendingSupplies: number };
}

const todayStr = () => format(new Date(), 'yyyy-MM-dd');
const hhmm = (iso: string) => format(new Date(iso), 'HH:mm');
const stay = (r: OpsReservation) => `${format(parseISO(r.start), 'M/d')}–${format(parseISO(r.end), 'M/d')} · ${r.nights}박`;
const msgTime = (iso: string) => (isToday(new Date(iso)) ? hhmm(iso) : format(new Date(iso), 'M/d HH:mm'));
const chatHref = (r: OpsReservation) => `/admin/messages?eventId=${r.id}&guestName=${encodeURIComponent(r.guestName)}&propertyId=${r.propertyId}`;
const FLAG_TONE: Record<GuestFlag, 'info' | 'warning' | 'brand'> = { early_checkin: 'info', late_checkout: 'warning', request: 'brand' };

/** 게스트 한 명: 이름·투숙·채널 → 태그 → 최근 대화 → 대화 열기 */
function GuestBlock({ r, statusLine, action }: { r: OpsReservation; statusLine?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="t-body font-semibold text-stone-900">{r.guestName}</span>
        <span className="t-caption text-stone-600">{stay(r)}</span>
        {r.guests ? <span className="t-caption text-stone-500">{r.guests}명</span> : null}
        <span className="t-micro text-stone-500 bg-stone-100 px-1.5 py-0.5">{r.channel}</span>
      </div>
      {statusLine}
      {r.flags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {r.flags.map(f => <Badge key={f} tone={FLAG_TONE[f]}>{GUEST_FLAG_LABEL[f]}</Badge>)}
        </div>
      )}
      {r.messages.length > 0 ? (
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
      )}
      <div className="flex gap-2 flex-wrap">
        {r.hasChat && (
          <Link href={chatHref(r)} className="inline-flex items-center gap-1.5 min-h-[36px] px-3 border border-stone-300 bg-white t-caption text-stone-800">
            <MessageSquare size={14} /> 대화 열기{r.unread > 0 && <span className="ml-1 min-w-[18px] h-[18px] px-1 bg-[var(--brand)] text-white t-micro flex items-center justify-center">{r.unread}</span>}
          </Link>
        )}
        {action}
      </div>
    </div>
  );
}

export default function OpsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<OpsData | null>(null);
  const [properties, setProperties] = useState<CalendarProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [cameraFor, setCameraFor] = useState<string | null>(null);
  const [showMaintenance, setShowMaintenance] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [oRes, pRes] = await Promise.all([fetch('/api/ops/today'), fetch('/api/properties')]);
      if (oRes.ok) setData(await oRes.json());
      else toast.error('정비 현황을 불러오지 못했습니다.');
      if (pRes.ok) setProperties(await pRes.json());
    } catch {
      toast.error('정비 현황을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (user) load(); }, [user, load]);
  useRefetchOnReturn(() => load(true));

  const working = useMemo(() => (data?.properties ?? []).filter(p => p.hasWork), [data]);
  const idle = useMemo(() => (data?.properties ?? []).filter(p => !p.hasWork), [data]);
  const totals = useMemo(() => ({
    checkins: working.reduce((n, p) => n + p.checkins.length, 0),
    checkouts: working.reduce((n, p) => n + p.checkouts.length, 0),
    cleanings: working.filter(p => p.cleaning).length,
  }), [working]);

  const confirmCheckout = async (p: OpsProperty) => {
    if (!(await confirmDialog({ title: `${p.name} 체크아웃 확인`, message: '배정된 청소담당자에게 청소 시작 알림이 갑니다.', confirmLabel: '확인' }))) return;
    setBusy(`checkout:${p.id}`);
    try {
      const res = await fetch('/api/checkout/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: p.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || '확인에 실패했습니다.'); return; }
      toast.success(d.notified ? `청소담당자 ${d.notified}명에게 알렸습니다.` : '체크아웃을 확인했습니다.');
      await load(true);
    } catch { toast.error('확인에 실패했습니다.'); } finally { setBusy(null); }
  };

  const assignCleaner = async (p: OpsProperty) => {
    const cleanerId = assign[p.id];
    if (!cleanerId) return;
    setBusy(`assign:${p.id}`);
    try {
      const res = p.cleaning
        ? await fetch('/api/cleanings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.cleaning.id, cleanerId, status: 'pending', isOpen: false }) })
        : await fetch('/api/cleanings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: p.id, date: todayStr(), cleanerId, status: 'pending' }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || '배정에 실패했습니다.'); return; }
      toast.success(`${data?.cleaners.find(c => c.id === cleanerId)?.name ?? '담당자'}에게 배정했습니다.`);
      await load(true);
    } catch { toast.error('배정에 실패했습니다.'); } finally { setBusy(null); }
  };

  /** 정비 완료: 청소 행을 done 으로, 오늘 체크인 게스트(Beds24)가 있으면 정비 완료 안내. 캘린더와 같은 순서. */
  const completeCleaning = async (p: OpsProperty) => {
    const checkin = p.checkins.find(r => r.hasChat) ?? p.checkins[0];
    const msg = checkin?.hasChat
      ? `${p.name} 청소를 완료로 기록하고, 오늘 체크인 게스트(${checkin.guestName})에게 정비 완료 안내를 보냅니다.`
      : `${p.name} 청소를 완료로 기록합니다.`;
    if (!(await confirmDialog({ title: '정비 완료', message: msg, confirmLabel: '완료' }))) return;
    setBusy(`done:${p.id}`);
    try {
      const res = p.cleaning
        ? await fetch('/api/cleanings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.cleaning.id, status: 'done', completedAt: new Date().toISOString() }) })
        : await fetch('/api/cleanings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: p.id, date: todayStr(), status: 'done' }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || '정비 완료 처리에 실패했습니다.'); return; }
      if (checkin?.hasChat) {
        try {
          const send = await fetch('/api/beds24/messages/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: checkin.id, propertyId: p.id, text: getRoomReadyMessage(properties, p.id) }),
          });
          const d = await send.json().catch(() => null);
          if (!send.ok || d?.deliveryStatus !== 'sent') toast.error(`정비 완료는 저장됐지만 게스트 메시지 전송에 실패했습니다.\n사유: ${d?.beds24Error || d?.error || `HTTP ${send.status}`}`);
          else toast.success('정비 완료. 게스트에게 안내를 보냈습니다.');
        } catch { toast.error('정비 완료는 저장됐지만 게스트 메시지 전송 요청에 실패했습니다.'); }
      } else {
        toast.success('정비 완료로 기록했습니다.');
      }
      await load(true);
    } catch { toast.error('정비 완료 처리에 실패했습니다.'); } finally { setBusy(null); }
  };

  const allProps = (data?.properties ?? []).map(p => ({ id: p.id, name: p.name }));

  return (
    <PullToRefresh onRefresh={() => load(true)}>
      <div className="max-w-4xl mx-auto space-y-6 pb-nav">
        <PageHeader eyebrow="숙박 호스팅" title="정비" description={format(new Date(), 'M월 d일 (EEE)', { locale: ko })} />

        {loading || !data ? (
          <SkeletonList count={3} rows={3} />
        ) : (
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

            {/* 2. 지점 카드 */}
            {working.map(p => {
              const cleaningDone = p.cleaning?.status === 'done';
              const leaving = p.camera.find(s => s.leaving);
              const co = p.checkoutStatus;
              return (
                <Card key={p.id} padded={false}>
                  <div className="px-4 py-3 flex items-center gap-2 border-b border-stone-200 bg-stone-50">
                    <span className="t-lead font-semibold text-stone-900">{p.name}</span>
                    {cleaningDone ? <Badge tone="success"><Check size={12} /> 정비 완료</Badge>
                      : p.cleaning?.cleanerName ? <Badge tone="brand">청소 · {p.cleaning.cleanerName}</Badge>
                      : (p.checkouts.length > 0 || p.cleaning) ? <Badge tone="danger">청소 미배정</Badge> : null}
                    <button type="button" onClick={() => setCameraFor(p.id)} className="ml-auto tap flex items-center justify-center text-stone-500 hover:text-stone-900" aria-label={`${p.name} 복도 카메라`}>
                      <Camera size={20} />
                    </button>
                  </div>

                  <div className="px-4 py-4 space-y-5">
                    {/* 체크아웃 */}
                    {p.checkouts.length > 0 && (
                      <section className="space-y-3">
                        <p className="t-label text-amber-700 flex items-center gap-1"><ArrowUpRight size={13} /> 체크아웃</p>
                        {p.checkouts.map(r => (
                          <GuestBlock
                            key={r.id}
                            r={r}
                            statusLine={
                              co?.confirmed ? (
                                <p className="t-caption text-emerald-700 flex items-center gap-1"><Check size={13} /> {co.confirmedBy === 'guest_pad' ? '게스트가 패드에서 체크아웃' : '체크아웃 확인'} {co.confirmedAt && hhmm(co.confirmedAt)}</p>
                              ) : leaving ? (
                                <p className="t-caption text-amber-700">카메라 {hhmm(leaving.capturedAt)} 퇴실로 보임{leaving.summary ? ` · ${leaving.summary}` : ''}</p>
                              ) : (
                                <p className="t-caption text-stone-500">아직 체크아웃 확인 전{p.camera.length > 0 ? ` · 카메라 ${p.camera.length}장, 퇴실 판정 없음` : ''}</p>
                              )
                            }
                            action={!co?.confirmed && <Button size="sm" onClick={() => confirmCheckout(p)} loading={busy === `checkout:${p.id}`}>체크아웃 확인</Button>}
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

                    {/* 체크인 */}
                    {p.checkins.length > 0 && (
                      <section className="space-y-3">
                        <p className="t-label text-emerald-700 flex items-center gap-1"><ArrowDownRight size={13} /> 체크인</p>
                        {p.checkins.map(r => <GuestBlock key={r.id} r={r} />)}
                      </section>
                    )}

                    {/* 청소 */}
                    <section className="space-y-2 border-t border-stone-100 pt-3">
                      <p className="t-label text-stone-500">청소</p>
                      {(p.cleaning?.supplies || p.cleaning?.notes) && (
                        <p className="t-caption text-stone-600">{[p.cleaning?.supplies, p.cleaning?.notes].filter(Boolean).join(' · ')}</p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        {cleaningDone ? (
                          <span className="t-caption text-emerald-700">정비 완료{p.cleaning?.cleanerName ? ` · ${p.cleaning.cleanerName}` : ''}</span>
                        ) : p.cleaning?.cleanerName ? (
                          <span className="t-caption text-stone-700">{p.cleaning.cleanerName} 배정됨</span>
                        ) : (
                          <>
                            <Select value={assign[p.id] ?? ''} onChange={e => setAssign(prev => ({ ...prev, [p.id]: e.target.value }))} className="!w-auto min-w-[150px] !min-h-[36px] !text-[14px]">
                              <option value="">담당자 선택</option>
                              {data.cleaners.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </Select>
                            <Button size="sm" variant="secondary" onClick={() => assignCleaner(p)} disabled={!assign[p.id]} loading={busy === `assign:${p.id}`}>배정</Button>
                          </>
                        )}
                        {!cleaningDone && (
                          <Button size="sm" className="ml-auto" onClick={() => completeCleaning(p)} loading={busy === `done:${p.id}`}>정비 완료</Button>
                        )}
                      </div>
                    </section>
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
            <div className="grid grid-cols-3 gap-2">
              {[
                { href: '/admin/cleaning-requests', label: '청소 신청', count: data.counts.pendingApplications, icon: Hand },
                { href: '/admin/issues', label: '이슈', count: data.counts.openIssues, icon: AlertTriangle },
                { href: '/admin/supplies', label: '비품 요청', count: data.counts.pendingSupplies, icon: Package },
              ].map(t => (
                <Link key={t.href} href={t.href} className={`bg-white border p-3 flex flex-col gap-1 ${t.count > 0 ? 'border-amber-300' : 'border-stone-200'}`}>
                  <span className="flex items-center gap-1.5 t-micro text-stone-500"><t.icon size={13} /> {t.label}</span>
                  <span className={`t-title ${t.count > 0 ? 'text-amber-700' : 'text-stone-400'}`}>{t.count}<span className="t-caption font-normal ml-0.5">건</span></span>
                </Link>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Link href="/admin/cleaners" className="bg-white border border-stone-200 p-3 flex items-center gap-2 t-caption text-stone-700"><Users size={15} /> 청소 담당자 <ChevronRight size={14} className="ml-auto text-stone-400" /></Link>
              <Link href="/admin/cleaning-report" className="bg-white border border-stone-200 p-3 flex items-center gap-2 t-caption text-stone-700"><FileBarChart size={15} /> 청소 보고서 <ChevronRight size={14} className="ml-auto text-stone-400" /></Link>
              <button type="button" onClick={() => setShowMaintenance(true)} className="bg-white border border-stone-200 p-3 flex items-center gap-2 t-caption text-stone-700 text-left"><Wrench size={15} /> 객실정비 등록 <ChevronRight size={14} className="ml-auto text-stone-400" /></button>
            </div>
          </>
        )}

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
  const [loaded, setLoaded] = useState<{ id: string; shots: Shot[] } | null>(null);
  const loading = !!propertyId && loaded?.id !== propertyId;
  const shots = loaded?.id === propertyId ? loaded.shots : [];

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    fetch(`/api/camera/snapshots?propertyId=${propertyId}&date=${todayStr()}`)
      .then(r => (r.ok ? r.json() : { snapshots: [] }))
      .then(d => { if (!cancelled) setLoaded({ id: propertyId, shots: d.snapshots ?? [] }); })
      .catch(() => { if (!cancelled) setLoaded({ id: propertyId, shots: [] }); });
    return () => { cancelled = true; };
  }, [propertyId]);

  const name = properties.find(p => p.id === propertyId)?.name ?? '';
  return (
    <Sheet open={!!propertyId} onClose={onClose} title={`${name} 복도 카메라`} description="오늘 감지된 사진입니다. 사진을 누르면 크게 보입니다." size="lg">
      <div className="flex gap-1.5 overflow-x-auto pb-3">
        {properties.map(p => (
          <button key={p.id} type="button" onClick={() => onSelect(p.id)} className={`shrink-0 px-3 min-h-[32px] t-caption border ${p.id === propertyId ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-600 border-stone-200'}`}>
            {p.name}
          </button>
        ))}
      </div>
      {loading ? (
        <SkeletonList count={1} rows={2} />
      ) : shots.length === 0 ? (
        <p className="t-caption text-stone-500 py-6 text-center">오늘 사진이 없습니다. 카메라가 사람을 감지하면 5분 안에 들어옵니다.</p>
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
