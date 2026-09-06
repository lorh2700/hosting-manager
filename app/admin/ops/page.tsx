'use client';

/**
 * 정비 허브 — 오늘의 체크아웃·청소·카메라를 지점별 카드 한 장에서 처리한다.
 *  1. 지점 카드: 체크아웃 상태 + 복도 카메라 최신 사진 + [체크아웃 확인], 청소 담당자 배정 + [정비 완료]
 *  2. 처리할 것: 청소 신청 대기 · 미해결 이슈 · 비품 요청
 *  3. 바로가기: 청소 담당자 · 청소 보고서 · 객실정비 등록
 * 데이터는 /api/dashboard 한 번으로 받는다 (오늘 화면과 같은 페이로드).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Camera, Check, ChevronRight, Hand, AlertTriangle, Package, Users, FileBarChart, Wrench, ExternalLink } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Badge, Button, Card, EmptyState, PageHeader, Select, Sheet, SkeletonList, PullToRefresh, toast, confirmDialog } from '@/components/ui';
import { useRefetchOnReturn } from '@/lib/hooks/useRefetchOnReturn';
import { getRoomReadyMessage, type Property as CalendarProperty } from '@/app/admin/calendar/types';
import { CreateMaintenanceModal } from '@/app/admin/calendar/components/CreateMaintenanceModal';

interface Reservation { id: string; propertyId: string; propertyName: string; title: string; start: string; end: string; source?: string | null; dataSource?: 'event' | 'booking' }
interface CleaningInfo { cleanerId: string | null; status: string; isOpen: boolean }
interface CheckoutStatus { confirmed: boolean; confirmedAt: string | null; confirmedBy: string | null; signals?: { kind: string; at: string; note: string | null }[] }
interface CameraShot { id: string; capturedAt: string; url: string | null; leaving: boolean; summary: string | null }
interface Dashboard {
  propsMap: Record<string, string>;
  reservations: Reservation[];
  cleaningsMap: Record<string, CleaningInfo>;
  cleanersMap: Record<string, string>;
  checkoutToday: Record<string, CheckoutStatus>;
  cameraToday: Record<string, CameraShot[]>;
  pendingApplications: number;
  openIssues: number;
  pendingSupplies: number;
}

const todayStr = () => format(new Date(), 'yyyy-MM-dd');
const hhmm = (iso: string) => format(new Date(iso), 'HH:mm');

export default function OpsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [properties, setProperties] = useState<CalendarProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [cameraFor, setCameraFor] = useState<string | null>(null);
  const [showMaintenance, setShowMaintenance] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [dRes, pRes] = await Promise.all([fetch('/api/dashboard'), fetch('/api/properties')]);
      if (dRes.ok) setData(await dRes.json());
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

  const today = todayStr();
  const cards = useMemo(() => {
    if (!data) return [];
    const list = Object.entries(data.propsMap).map(([id, name]) => {
      const checkouts = data.reservations.filter(r => r.propertyId === id && r.end === today);
      const checkins = data.reservations.filter(r => r.propertyId === id && r.start === today);
      const cleaning = data.cleaningsMap[`${id}_${today}`] ?? null;
      return { id, name, checkouts, checkins, cleaning, checkout: data.checkoutToday[id] ?? null, camera: data.cameraToday[id] ?? [] };
    });
    // 오늘 할 일이 있는 지점을 위로
    return list.sort((a, b) => Number(b.checkouts.length + b.checkins.length > 0) - Number(a.checkouts.length + a.checkins.length > 0) || a.name.localeCompare(b.name));
  }, [data, today]);

  const cleanerOptions = useMemo(() => Object.entries(data?.cleanersMap ?? {}).map(([id, name]) => ({ id, name })), [data]);

  /** 오늘 이 숙소의 청소 행 id 를 찾는다 (없으면 null). 배정·정비 완료 모두 이 행에 쓴다. */
  const findCleaningId = async (propertyId: string): Promise<string | null> => {
    const res = await fetch(`/api/cleanings?propertyIds=${encodeURIComponent(propertyId)}`);
    if (!res.ok) return null;
    const list = await res.json();
    const match = (Array.isArray(list) ? list : []).find((c: { propertyId: string; date: string; id: string }) => c.propertyId === propertyId && c.date === today);
    return match?.id ?? null;
  };

  const confirmCheckout = async (propertyId: string, name: string) => {
    if (!(await confirmDialog({ title: `${name} 체크아웃 확인`, message: '배정된 청소담당자에게 청소 시작 알림이 갑니다.', confirmLabel: '확인' }))) return;
    setBusy(`checkout:${propertyId}`);
    try {
      const res = await fetch('/api/checkout/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || '확인에 실패했습니다.'); return; }
      setData(prev => prev ? { ...prev, checkoutToday: { ...prev.checkoutToday, [propertyId]: { confirmed: true, confirmedAt: d.confirmedAt ?? new Date().toISOString(), confirmedBy: d.confirmedBy ?? 'host' } } } : prev);
      toast.success(d.notified ? `청소담당자 ${d.notified}명에게 알렸습니다.` : '체크아웃을 확인했습니다.');
    } catch { toast.error('확인에 실패했습니다.'); } finally { setBusy(null); }
  };

  const assignCleaner = async (propertyId: string) => {
    const cleanerId = assign[propertyId];
    if (!cleanerId) return;
    setBusy(`assign:${propertyId}`);
    try {
      const existingId = await findCleaningId(propertyId);
      const res = existingId
        ? await fetch('/api/cleanings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: existingId, cleanerId, status: 'pending', isOpen: false }) })
        : await fetch('/api/cleanings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId, date: today, cleanerId, status: 'pending' }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || '배정에 실패했습니다.'); return; }
      toast.success(`${data?.cleanersMap[cleanerId] ?? '담당자'}에게 배정했습니다.`);
      await load(true);
    } catch { toast.error('배정에 실패했습니다.'); } finally { setBusy(null); }
  };

  /** 정비 완료: 오늘 청소 행을 done 으로, 오늘 체크인 게스트(Beds24)가 있으면 정비 완료 안내 메시지. 캘린더의 정비 완료와 같은 순서. */
  const completeCleaning = async (propertyId: string, name: string, checkin: Reservation | undefined) => {
    const msg = checkin && checkin.dataSource === 'event'
      ? `${name} 청소를 완료로 기록하고, 오늘 체크인 게스트(${checkin.title || '게스트'})에게 정비 완료 안내를 보냅니다.`
      : `${name} 청소를 완료로 기록합니다.`;
    if (!(await confirmDialog({ title: '정비 완료', message: msg, confirmLabel: '완료' }))) return;
    setBusy(`done:${propertyId}`);
    try {
      const existingId = await findCleaningId(propertyId);
      const res = existingId
        ? await fetch('/api/cleanings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: existingId, status: 'done', completedAt: new Date().toISOString() }) })
        : await fetch('/api/cleanings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId, date: today, status: 'done' }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || '정비 완료 처리에 실패했습니다.'); return; }

      if (checkin && checkin.dataSource === 'event') {
        try {
          const send = await fetch('/api/beds24/messages/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: checkin.id, propertyId, text: getRoomReadyMessage(properties, propertyId) }),
          });
          const d = await send.json().catch(() => null);
          if (!send.ok || d?.deliveryStatus !== 'sent') {
            toast.error(`정비 완료는 저장됐지만 게스트 메시지 전송에 실패했습니다.\n사유: ${d?.beds24Error || d?.error || `HTTP ${send.status}`}\n메시지 화면에서 다시 보내주세요.`);
          } else {
            toast.success('정비 완료. 게스트에게 안내를 보냈습니다.');
          }
        } catch {
          toast.error('정비 완료는 저장됐지만 게스트 메시지 전송 요청에 실패했습니다.');
        }
      } else {
        toast.success('정비 완료로 기록했습니다.');
      }
      await load(true);
    } catch { toast.error('정비 완료 처리에 실패했습니다.'); } finally { setBusy(null); }
  };

  const cameraProps = cards.map(c => ({ id: c.id, name: c.name }));

  return (
    <PullToRefresh onRefresh={() => load(true)}>
      <div className="max-w-4xl mx-auto space-y-6 pb-nav">
        <PageHeader
          eyebrow="숙박 호스팅"
          title="정비"
          description={`${format(new Date(), 'M월 d일 (EEE)', { locale: ko })} · 체크아웃 확인, 청소 배정, 정비 완료를 여기서 처리합니다.`}
        />

        {loading || !data ? (
          <SkeletonList count={3} rows={2} />
        ) : (
          <>
            {/* 처리할 것 */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { href: '/admin/cleaning-requests', label: '청소 신청', count: data.pendingApplications, icon: Hand },
                { href: '/admin/issues', label: '이슈', count: data.openIssues, icon: AlertTriangle },
                { href: '/admin/supplies', label: '비품 요청', count: data.pendingSupplies, icon: Package },
              ].map(t => (
                <Link key={t.href} href={t.href} className={`bg-white border p-3 flex flex-col gap-1 ${t.count > 0 ? 'border-amber-300' : 'border-stone-200'}`}>
                  <span className="flex items-center gap-1.5 t-micro text-stone-500"><t.icon size={13} /> {t.label}</span>
                  <span className={`t-title ${t.count > 0 ? 'text-amber-700' : 'text-stone-400'}`}>{t.count}<span className="t-caption font-normal ml-0.5">건</span></span>
                </Link>
              ))}
            </div>

            {/* 지점 카드 */}
            {cards.length === 0 ? (
              <EmptyState icon={Wrench} title="관리하는 숙소가 없습니다" />
            ) : cards.map(c => {
              const hasWork = c.checkouts.length > 0 || c.checkins.length > 0;
              const checkin = c.checkins[0];
              const cleanerName = c.cleaning?.cleanerId ? data.cleanersMap[c.cleaning.cleanerId] ?? '담당자' : null;
              const cleaningDone = c.cleaning?.status === 'done';
              const leaving = c.camera.find(s => s.leaving);
              return (
                <Card key={c.id} padded={false} className={hasWork ? '' : 'opacity-80'}>
                  <div className="px-4 py-3 flex items-center gap-2 border-b border-stone-100">
                    <span className="t-lead font-semibold text-stone-900">{c.name}</span>
                    {c.checkouts.length > 0 && <Badge tone="warning">체크아웃 {c.checkouts.length}</Badge>}
                    {c.checkins.length > 0 && <Badge tone="info">체크인 {c.checkins.length}</Badge>}
                    {!hasWork && <span className="t-caption text-stone-400">오늘 일정 없음</span>}
                    <button type="button" onClick={() => setCameraFor(c.id)} className="ml-auto tap flex items-center justify-center text-stone-500 hover:text-stone-900" aria-label={`${c.name} 복도 카메라`}>
                      <Camera size={20} />
                    </button>
                  </div>

                  {hasWork && (
                    <div className="px-4 py-3 space-y-4">
                      {/* 체크아웃 */}
                      {c.checkouts.length > 0 && (
                        <div>
                          <p className="t-label text-stone-500 mb-1.5">체크아웃</p>
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="t-body text-stone-900 truncate">{c.checkouts.map(r => r.title || '게스트').join(', ')}</p>
                              {c.checkout?.confirmed ? (
                                <p className="t-caption text-emerald-700 flex items-center gap-1 mt-0.5">
                                  <Check size={13} /> {c.checkout.confirmedBy === 'guest_pad' ? '게스트 셀프 체크아웃' : '체크아웃 확인'} {c.checkout.confirmedAt && hhmm(c.checkout.confirmedAt)}
                                </p>
                              ) : leaving ? (
                                <p className="t-caption text-amber-700 mt-0.5">퇴실로 보임 {hhmm(leaving.capturedAt)}{leaving.summary ? ` · ${leaving.summary}` : ''}</p>
                              ) : (
                                <p className="t-caption text-stone-400 mt-0.5">체크아웃 대기{c.camera.length > 0 ? ` · 카메라 ${c.camera.length}장, 퇴실 판정 없음` : ''}</p>
                              )}
                            </div>
                            {!c.checkout?.confirmed && (
                              <Button size="sm" onClick={() => confirmCheckout(c.id, c.name)} loading={busy === `checkout:${c.id}`}>체크아웃 확인</Button>
                            )}
                          </div>
                          {c.camera.length > 0 && (
                            <div className="flex gap-1.5 overflow-x-auto mt-2">
                              {c.camera.map(s => s.url ? (
                                <button key={s.id} type="button" onClick={() => setCameraFor(c.id)} className={`relative shrink-0 border ${s.leaving ? 'border-amber-400' : 'border-stone-200'}`}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={s.url} alt={`복도 ${hhmm(s.capturedAt)}`} className="h-16 w-24 object-cover" />
                                  <span className="absolute bottom-0 right-0 bg-black/60 text-white t-micro px-1">{hhmm(s.capturedAt)}</span>
                                </button>
                              ) : null)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 청소 */}
                      <div>
                        <p className="t-label text-stone-500 mb-1.5">청소{checkin ? ` · 오늘 체크인 ${checkin.title || '게스트'}` : ''}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {cleaningDone ? (
                            <Badge tone="success"><Check size={12} /> 정비 완료{cleanerName ? ` · ${cleanerName}` : ''}</Badge>
                          ) : cleanerName ? (
                            <Badge tone="brand">{cleanerName} 배정</Badge>
                          ) : (
                            <>
                              <Badge tone="danger">미배정</Badge>
                              <Select value={assign[c.id] ?? ''} onChange={e => setAssign(prev => ({ ...prev, [c.id]: e.target.value }))} className="!w-auto min-w-[140px] !min-h-[36px] !text-[14px]">
                                <option value="">담당자 선택</option>
                                {cleanerOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                              </Select>
                              <Button size="sm" variant="secondary" onClick={() => assignCleaner(c.id)} disabled={!assign[c.id]} loading={busy === `assign:${c.id}`}>배정</Button>
                            </>
                          )}
                          {!cleaningDone && (
                            <Button size="sm" className="ml-auto" onClick={() => completeCleaning(c.id, c.name, checkin)} loading={busy === `done:${c.id}`}>정비 완료</Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}

            {/* 바로가기 */}
            <div className="grid grid-cols-3 gap-2">
              <Link href="/admin/cleaners" className="bg-white border border-stone-200 p-3 flex items-center gap-2 t-caption text-stone-700"><Users size={15} /> 청소 담당자 <ChevronRight size={14} className="ml-auto text-stone-400" /></Link>
              <Link href="/admin/cleaning-report" className="bg-white border border-stone-200 p-3 flex items-center gap-2 t-caption text-stone-700"><FileBarChart size={15} /> 청소 보고서 <ChevronRight size={14} className="ml-auto text-stone-400" /></Link>
              <button type="button" onClick={() => setShowMaintenance(true)} className="bg-white border border-stone-200 p-3 flex items-center gap-2 t-caption text-stone-700 text-left"><Wrench size={15} /> 객실정비 등록 <ChevronRight size={14} className="ml-auto text-stone-400" /></button>
            </div>
          </>
        )}

        <CameraSheet propertyId={cameraFor} properties={cameraProps} onSelect={setCameraFor} onClose={() => setCameraFor(null)} />

        {showMaintenance && (
          <CreateMaintenanceModal
            properties={cameraProps}
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
  // 어느 지점의 사진을 들고 있는지 함께 기억한다 — 지점이 바뀌면 그 자체가 "로딩 중" 상태.
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
