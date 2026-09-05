'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRefetchOnReturn } from '@/lib/hooks/useRefetchOnReturn';
import {
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  MessageSquare,
  Brush,
  Package,
  AlertTriangle,
  Loader2,
  X,
  Hand,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import {
  addDays,
  format,
  isToday,
  isTomorrow,
  startOfToday,
  endOfMonth,
  parseISO,
} from 'date-fns';
import { ko } from 'date-fns/locale';

interface Reservation {
  id: string;
  propertyId: string;
  propertyName: string;
  title: string;
  start: string;
  end: string;
  phone?: string;
  email?: string;
  guests?: number;
  source?: string | null;
  dataSource?: 'event' | 'booking';
}

function formatChannel(source?: string | null): string | null {
  if (!source) return null;
  const s = source.toLowerCase();
  if (s.includes('airbnb') || s.includes('에어비앤비')) return '에어비앤비';
  if (s.includes('booking')) return '부킹닷컴';
  if (s.includes('agoda') || s.includes('아고다')) return '아고다';
  if (s.includes('expedia') || s.includes('익스피디아')) return '익스피디아';
  if (s.includes('vrbo')) return 'VRBO';
  if (s.includes('stayfolio') || s.includes('스테이폴리오')) return '스테이폴리오';
  if (s === 'direct') return '직접예약';
  if (s === 'beds24') return 'Beds24';
  return source;
}

interface GuestMessage {
  id: string;
  text: string;
  sender: string;
  createdAt: string;
}

interface Cleaner {
  id: string;
  name: string;
}

interface UnassignedCheckout {
  key: string;
  propertyId: string;
  propertyName: string;
  date: string;
  guestName: string;
}

interface CleaningInfo {
  cleanerId: string | null;
  status: string;
  isOpen?: boolean;
}

interface DayGroup {
  date: string;
  label: string;
  isToday: boolean;
  isTomorrow: boolean;
  checkins: { reservation: Reservation; nights: number }[];
  checkouts: { reservation: Reservation; cleanerName: string; cleaningStatus: 'done' | 'pending' | 'unassigned' }[];
}

const STATUS_BADGE: Record<'done' | 'pending' | 'unassigned', { ko: string; cls: string }> = {
  done:       { ko: '완료',   cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  pending:    { ko: '대기',   cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  unassigned: { ko: '미배정', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
};

const CHECKIN_BADGE = { ko: '체크인', cls: 'bg-stone-100 text-stone-800 ring-stone-300' };

function StatusPill({ ko, cls }: { ko: string; cls: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-1 ring-1 text-[10px] leading-none uppercase tracking-widest ${cls}`}>
      {ko}
    </span>
  );
}

export default function HostDashboard() {
  const [dayGroups, setDayGroups] = useState<DayGroup[]>([]);
  const [totalProperties, setTotalProperties] = useState(0);
  const [loading, setLoading] = useState(true);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pendingSupplies, setPendingSupplies] = useState(0);
  const [openIssues, setOpenIssues] = useState(0);
  const [pendingApplications, setPendingApplications] = useState(0);
  const [monthUnassigned, setMonthUnassigned] = useState<UnassignedCheckout[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [assignSelection, setAssignSelection] = useState<Record<string, string>>({});
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [showUnassigned, setShowUnassigned] = useState(true);
  const [selectedGuest, setSelectedGuest] = useState<{ reservation: Reservation; nights: number } | null>(null);
  const [guestMessages, setGuestMessages] = useState<GuestMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  // 탭에 돌아오면 조용히 다시 불러온다 (스켈레톤 없이 값만 갱신).
  const [reloadKey, setReloadKey] = useState(0);
  useRefetchOnReturn(() => setReloadKey(k => k + 1));

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/dashboard');
        if (cancelled) return;
        if (!res.ok) { setLoading(false); return; }
        const data = await res.json();
        if (cancelled) return;

        // 담당자 목록은 대시보드 응답(cleanersMap)에 이미 들어 있다 — 별도 호출 없음.
        setCleaners(Object.entries((data.cleanersMap ?? {}) as Record<string, string>).map(([id, name]) => ({ id, name })));
        setTotalProperties(data.properties);
        setUnreadMessages(data.unreadMessages);
        setPendingSupplies(data.pendingSupplies);
        setOpenIssues(data.openIssues);
        setPendingApplications(data.pendingApplications ?? 0);

        if (!data.reservations?.length) { setLoading(false); return; }

        const propsMap: Record<string, string> = data.propsMap;
        const cleaningsMap: Record<string, CleaningInfo> = data.cleaningsMap;
        const cleanersMap: Record<string, string> = data.cleanersMap;

        if (isAdmin) {
          // Show every upcoming checkout (today → end of month) that lacks
          // an assigned cleaner. The `isOpen` flag doesn't count as an
          // assignment — those slots are still waiting for admin action.
          const todayStr = format(startOfToday(), 'yyyy-MM-dd');
          const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd');
          const seen = new Set<string>();
          const unassigned: UnassignedCheckout[] = [];
          for (const r of data.reservations as Reservation[]) {
            if (!r.end || r.end < todayStr || r.end > monthEnd) continue;
            const key = `${r.propertyId}_${r.end}`;
            if (seen.has(key)) continue;
            const cleaning = cleaningsMap[key];
            if (cleaning?.cleanerId) continue;
            seen.add(key);
            unassigned.push({
              key,
              propertyId: r.propertyId,
              propertyName: r.propertyName || propsMap[r.propertyId] || '',
              date: r.end,
              guestName: r.title || '',
            });
          }
          unassigned.sort((a, b) => a.date.localeCompare(b.date));
          setMonthUnassigned(unassigned);
        }

        const groups: DayGroup[] = [];
        for (let offset = 0; offset < 7; offset++) {
          const d = addDays(startOfToday(), offset);
          const dateStr = format(d, 'yyyy-MM-dd');

          const checkins = (data.reservations as Reservation[])
            .filter(r => r.start === dateStr)
            .map(r => {
              const nights = Math.round((new Date(r.end).getTime() - new Date(r.start).getTime()) / 86400000);
              return { reservation: { ...r, propertyName: r.propertyName || propsMap[r.propertyId] || '' }, nights };
            });

          const checkouts = (data.reservations as Reservation[])
            .filter(r => r.end === dateStr)
            .map(r => {
              const cleaning = cleaningsMap[`${r.propertyId}_${dateStr}`];
              const cleanerName = cleaning?.cleanerId ? (cleanersMap[cleaning.cleanerId] || '') : '';
              // "미배정" = no cleaner assigned, regardless of whether an
              // empty cleaning row exists. "대기" only when someone is
              // assigned but the cleaning hasn't been marked done yet.
              const cleaningStatus: 'done' | 'pending' | 'unassigned' =
                cleaning?.status === 'done'
                  ? 'done'
                  : cleaning?.cleanerId
                    ? 'pending'
                    : 'unassigned';
              return { reservation: { ...r, propertyName: r.propertyName || propsMap[r.propertyId] || '' }, cleanerName, cleaningStatus };
            });

          if (checkins.length > 0 || checkouts.length > 0) {
            let label: string;
            if (isToday(d)) label = '오늘';
            else if (isTomorrow(d)) label = '내일';
            else label = format(d, 'M월 d일 (EEE)', { locale: ko });

            groups.push({ date: dateStr, label, isToday: isToday(d), isTomorrow: isTomorrow(d), checkins, checkouts });
          }
        }

        setDayGroups(groups);
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user, isAdmin, reloadKey]);

  const handleAssign = async (item: UnassignedCheckout) => {
    const cleanerId = assignSelection[item.key];
    if (!cleanerId) return;
    setAssigningKey(item.key);
    try {
      // Look up an existing cleaning row for this slot first — when iCal
      // sync auto-created an "open" cleaning, we want to assign INTO that
      // row rather than create a duplicate (which would leave a stale
      // unassigned row and confuse the dashboard).
      const lookupRes = await fetch(
        `/api/cleanings?propertyIds=${encodeURIComponent(item.propertyId)}`,
      );
      let existingId: string | null = null;
      if (lookupRes.ok) {
        const list = await lookupRes.json();
        const match = (Array.isArray(list) ? list : []).find(
          (c: { date: string; propertyId: string; id: string }) =>
            c.propertyId === item.propertyId && c.date === item.date,
        );
        if (match) existingId = match.id;
      }

      const res = existingId
        ? await fetch('/api/cleanings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: existingId,
              cleanerId,
              status: 'pending',
              isOpen: false,
            }),
          })
        : await fetch('/api/cleanings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              propertyId: item.propertyId,
              date: item.date,
              cleanerId,
              status: 'pending',
              isOpen: false,
            }),
          });
      if (!res.ok) throw new Error('assign failed');
      const cleanerName = cleaners.find(c => c.id === cleanerId)?.name || '';
      setMonthUnassigned(prev => prev.filter(u => u.key !== item.key));
      setAssignSelection(prev => {
        const next = { ...prev };
        delete next[item.key];
        return next;
      });
      setDayGroups(prev => prev.map(g => ({
        ...g,
        checkouts: g.checkouts.map(c =>
          c.reservation.propertyId === item.propertyId && c.reservation.end === item.date
            ? { ...c, cleanerName, cleaningStatus: 'pending' as const }
            : c,
        ),
      })));
    } catch (err) {
      console.error(err);
      alert('청소 배정에 실패했습니다.');
    } finally {
      setAssigningKey(null);
    }
  };

  const openGuest = async (reservation: Reservation, nights: number) => {
    setSelectedGuest({ reservation, nights });
    if (reservation.dataSource !== 'event') {
      setGuestMessages([]);
      return;
    }
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/messages?eventId=${reservation.id}`);
      const data = res.ok ? await res.json() : [];
      const msgs: GuestMessage[] = (Array.isArray(data) ? data : []).map((m: Record<string, unknown>) => ({
        id: m.id as string,
        text: (m.text as string) || '',
        sender: (m.sender as string) || 'guest',
        createdAt: (m.createdAt as string) || '',
      }));
      msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setGuestMessages(msgs);
    } catch {
      setGuestMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  };

  const closeGuest = () => {
    setSelectedGuest(null);
    setGuestMessages([]);
  };

  const todayGroup = dayGroups.find(g => g.isToday);
  const todayIn = todayGroup?.checkins.length ?? 0;
  const todayOut = todayGroup?.checkouts.length ?? 0;
  const pendingCleanings = dayGroups.reduce(
    (sum, g) => sum + g.checkouts.filter(c => c.cleaningStatus !== 'done').length, 0
  );
  const unassignedCleanings = dayGroups.reduce(
    (sum, g) => sum + g.checkouts.filter(c => c.cleaningStatus === 'unassigned').length, 0
  );

  const actionItems = [
    { count: unreadMessages, label: '미읽은 메시지', href: '/admin/messages', icon: MessageSquare },
    { count: pendingApplications, label: '청소 신청 대기', href: '/admin/cleaning-requests', icon: Hand },
    { count: unassignedCleanings, label: '미배정 청소', href: '/admin/calendar', icon: Brush },
    { count: pendingSupplies, label: '비품 요청', href: '/admin/supplies', icon: Package },
    { count: openIssues, label: '미해결 이슈', href: '/admin/issues', icon: AlertTriangle },
  ];
  const hasActions = actionItems.some(a => a.count > 0);

  return (
    <div className="max-w-3xl mx-auto space-y-8 sm:space-y-10">
      <header>
        <p className="text-[11px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">숙박 호스팅</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-stone-900 tracking-tight">
          {format(new Date(), 'M월 d일 EEEE', { locale: ko })}
        </h1>
        <p className="text-stone-500 text-sm mt-2">
          {loading ? '불러오는 중...' : `${totalProperties}개 숙소 운영 중`}
        </p>
      </header>

      {loading && (
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="bg-stone-100 h-[78px]" />
            ))}
          </div>
          <div className="bg-stone-100 h-12" />
          <div className="bg-stone-100 h-48" />
        </div>
      )}

      {!loading && (<>
      {hasActions && (
        <div className="grid grid-cols-2 gap-px bg-stone-200 border border-stone-200">
          {actionItems.map(item => {
            const Icon = item.icon;
            const active = item.count > 0;
            return active ? (
              <Link
                key={item.label}
                href={item.href}
                className="bg-[var(--brand-tint)] p-4 sm:p-5 flex items-center gap-3 hover:bg-[var(--brand-tint-strong)] active:scale-[0.99] transition-colors"
              >
                <div className="w-9 h-9 bg-white flex items-center justify-center shrink-0 ring-1 ring-[var(--brand)]/30">
                  <Icon size={17} className="text-[var(--brand)]" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-semibold text-stone-900 tabular-nums leading-none">{item.count}</p>
                  <p className="text-[11px] uppercase tracking-widest text-stone-500 mt-1.5">{item.label}</p>
                </div>
              </Link>
            ) : (
              <div
                key={item.label}
                className="bg-white p-4 sm:p-5 flex items-center gap-3"
              >
                <div className="w-9 h-9 bg-stone-100 flex items-center justify-center shrink-0">
                  <Icon size={17} className="text-stone-300" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-semibold text-stone-300 tabular-nums leading-none">0</p>
                  <p className="text-[11px] uppercase tracking-widest text-stone-400 mt-1.5">{item.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-b border-stone-200 py-3 flex items-center gap-x-5 sm:gap-x-7 gap-y-1.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.25em] text-stone-400">오늘</span>
        <span className="flex items-baseline gap-1.5">
          <span className={`text-lg font-semibold tabular-nums ${todayIn > 0 ? 'text-stone-900' : 'text-stone-300'}`}>{todayIn}</span>
          <span className="text-[11px] uppercase tracking-widest text-stone-500">체크인</span>
        </span>
        <span className="text-stone-300">/</span>
        <span className="flex items-baseline gap-1.5">
          <span className={`text-lg font-semibold tabular-nums ${todayOut > 0 ? 'text-stone-900' : 'text-stone-300'}`}>{todayOut}</span>
          <span className="text-[11px] uppercase tracking-widest text-stone-500">체크아웃</span>
        </span>
        <span className="text-stone-300">/</span>
        <span className="flex items-baseline gap-1.5">
          <span className={`text-lg font-semibold tabular-nums ${pendingCleanings > 0 ? 'text-amber-700' : 'text-stone-300'}`}>{pendingCleanings}</span>
          <span className="text-[11px] uppercase tracking-widest text-stone-500">청소대기</span>
        </span>
      </div>

      {todayGroup && (todayGroup.checkins.length > 0 || todayGroup.checkouts.length > 0) && (
        <div className="bg-white border border-stone-200 overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-stone-200 flex items-center gap-3">
            <div>
              <p className="text-base sm:text-lg text-stone-900 font-semibold tracking-tight">오늘의 운영</p>
              <p className="text-xs text-stone-500 mt-0.5">
                {format(new Date(), 'M월 d일 (EEE)', { locale: ko })}
              </p>
            </div>
            <span className="ml-auto text-[10px] uppercase tracking-widest text-[var(--brand)] bg-[var(--brand-tint)] px-2.5 py-1 font-semibold">오늘</span>
          </div>

          {todayGroup.checkins.length > 0 && (
            <div className="px-5 sm:px-6 py-4 border-b border-stone-200">
              <div className="flex items-center gap-2 mb-3">
                <ArrowDownRight size={16} className="text-emerald-700" />
                <p className="text-sm text-stone-800 font-medium">체크인</p>
                <span className="text-xs text-stone-500 tabular-nums">{todayGroup.checkins.length}건</span>
              </div>
              <div className="space-y-px bg-stone-200">
                {todayGroup.checkins.map(({ reservation: r, nights }) => {
                  const channel = formatChannel(r.source);
                  return (
                    <button
                      type="button"
                      key={r.id + '-today-in'}
                      onClick={() => openGuest(r, nights)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-stone-50 hover:bg-white transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-stone-900 truncate flex items-center gap-2">
                          <span className="truncate">{r.propertyName}</span>
                          {channel && (
                            <span className="text-[10px] text-stone-700 bg-stone-200 px-1.5 py-0.5 shrink-0 uppercase tracking-wider">
                              {channel}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-stone-500 mt-0.5 truncate">{r.title || '게스트'}</p>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs shrink-0">
                        {r.guests ? (
                          <span className="text-stone-800 bg-stone-200 px-2 py-1 tabular-nums">{r.guests}명</span>
                        ) : null}
                        <span className="text-white bg-[var(--brand)] px-2 py-1 tabular-nums font-semibold">{nights}박</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {todayGroup.checkouts.length > 0 && (
            <div className="px-5 sm:px-6 py-4">
              <div className="flex items-center gap-2 mb-3">
                <Brush size={15} className="text-amber-600" />
                <p className="text-sm text-stone-800 font-medium">청소 필요</p>
                <span className="text-xs text-stone-500 tabular-nums">{todayGroup.checkouts.length}건</span>
              </div>
              <div className="space-y-px bg-stone-200">
                {todayGroup.checkouts.map(({ reservation: r, cleanerName, cleaningStatus }) => {
                  const badge = STATUS_BADGE[cleaningStatus];
                  return (
                    <div key={r.id + '-today-out'} className="flex items-center gap-3 px-4 py-3 bg-stone-50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-stone-900 truncate">
                          {r.propertyName}
                          {r.title && <span className="text-stone-500"> · {r.title}</span>}
                        </p>
                        {cleanerName && (
                          <p className="text-xs text-stone-500 mt-0.5 flex items-center gap-1.5">
                            {cleaningStatus === 'done' ? (
                              <Check size={11} className="text-emerald-700" />
                            ) : null}
                            {cleanerName}
                          </p>
                        )}
                      </div>
                      <StatusPill {...badge} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedGuest && (
        <div
          className="fixed inset-0 bg-stone-950/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={closeGuest}
        >
          <div
            className="bg-white border border-stone-200 w-full sm:max-w-xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 sm:px-6 py-5 border-b border-stone-200 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <p className="text-xs text-stone-500">{selectedGuest.reservation.propertyName}</p>
                  {formatChannel(selectedGuest.reservation.source) && (
                    <span className="text-[10px] text-stone-700 bg-stone-100 px-1.5 py-0.5 uppercase tracking-wider">
                      {formatChannel(selectedGuest.reservation.source)}
                    </span>
                  )}
                </div>
                <p className="text-lg text-stone-900 font-semibold truncate">
                  {selectedGuest.reservation.title || '게스트'}
                </p>
                <div className="flex items-center gap-2.5 mt-2 text-xs text-stone-500 flex-wrap">
                  <span>{format(parseISO(selectedGuest.reservation.start), 'M월 d일 (EEE)', { locale: ko })} 체크인</span>
                  <span className="text-stone-300">·</span>
                  <span>{selectedGuest.nights}박</span>
                  {selectedGuest.reservation.guests ? (
                    <><span className="text-stone-300">·</span><span>{selectedGuest.reservation.guests}명</span></>
                  ) : null}
                </div>
                {(selectedGuest.reservation.phone || selectedGuest.reservation.email) && (
                  <div className="flex items-center gap-2.5 mt-1.5 text-xs text-stone-500 flex-wrap">
                    {selectedGuest.reservation.phone && <span>{selectedGuest.reservation.phone}</span>}
                    {selectedGuest.reservation.email && <span className="truncate">{selectedGuest.reservation.email}</span>}
                  </div>
                )}
              </div>
              <button
                onClick={closeGuest}
                className="text-stone-500 hover:text-stone-900 transition-colors shrink-0 p-1"
                aria-label="닫기"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 bg-stone-50">
              {loadingMessages ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={20} className="animate-spin text-[var(--brand)]" />
                </div>
              ) : guestMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                  <MessageSquare size={22} className="text-stone-300" />
                  <p className="text-sm text-stone-500">
                    {selectedGuest.reservation.dataSource === 'event'
                      ? '주고받은 메시지가 없습니다.'
                      : '직접 예약은 대화 내역이 없습니다.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {guestMessages.map(m => {
                    const isGuest = m.sender === 'guest';
                    return (
                      <div key={m.id} className={`flex ${isGuest ? 'justify-start' : 'justify-end'}`}>
                        <div
                          className={`max-w-[80%] px-4 py-2.5 ${
                            isGuest
                              ? 'bg-white border border-stone-200 text-stone-800'
                              : 'bg-[var(--brand)] text-white'
                          }`}
                        >
                          <p className="text-sm whitespace-pre-wrap break-words">{m.text}</p>
                          <p className={`text-[10px] mt-1 ${isGuest ? 'text-stone-400' : 'text-white/70'}`}>
                            {m.createdAt ? format(parseISO(m.createdAt), 'M월 d일 HH:mm', { locale: ko }) : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-5 sm:px-6 py-3 border-t border-stone-200">
              <Link
                href="/admin/calendar"
                className="text-xs text-stone-500 hover:text-stone-900 inline-flex items-center gap-1 transition-colors"
              >
                캘린더에서 상세 관리 <ArrowRight size={12} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {isAdmin && monthUnassigned.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 overflow-hidden">
          <button
            onClick={() => setShowUnassigned(s => !s)}
            className="w-full px-4 sm:px-5 py-4 flex items-center gap-3 hover:bg-rose-100 transition-colors"
          >
            <Brush size={17} className="text-rose-700 shrink-0" />
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm text-stone-900 font-medium">이번 달 미배정 청소</p>
              <p className="text-xs text-stone-500 mt-0.5">
                {format(new Date(), 'M월', { locale: ko })} · {monthUnassigned.length}건 배정 필요
              </p>
            </div>
            <ArrowRight
              size={16}
              className={`text-stone-400 transition-transform ${showUnassigned ? 'rotate-90' : ''}`}
            />
          </button>
          {showUnassigned && (
            <div className="divide-y divide-stone-200 border-t border-rose-200">
              {cleaners.length === 0 ? (
                <div className="px-4 sm:px-5 py-6 text-center">
                  <p className="text-stone-500 text-xs mb-2">등록된 청소 담당자가 없습니다.</p>
                  <Link
                    href="/admin/cleaners"
                    className="text-rose-700 hover:text-rose-800 text-xs inline-flex items-center gap-1 transition-colors"
                  >
                    담당자 등록하기 <ArrowRight size={12} />
                  </Link>
                </div>
              ) : (
                monthUnassigned.map(item => {
                  const selected = assignSelection[item.key] || '';
                  const saving = assigningKey === item.key;
                  const dateLabel = format(new Date(item.date), 'M월 d일 (EEE)', { locale: ko });
                  return (
                    <div key={item.key} className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3 bg-white">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-stone-900 truncate">{item.propertyName}</p>
                        <p className="text-xs text-stone-500 mt-0.5">
                          {dateLabel}
                          {item.guestName && <span className="text-stone-400"> · {item.guestName}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          value={selected}
                          onChange={e => setAssignSelection(prev => ({ ...prev, [item.key]: e.target.value }))}
                          disabled={saving}
                          className="bg-white border border-stone-300 text-stone-900 text-xs px-3 py-2 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors disabled:opacity-50 min-w-[140px]"
                        >
                          <option value="">담당자 선택</option>
                          {cleaners.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAssign(item)}
                          disabled={!selected || saving}
                          className="bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white text-xs font-semibold uppercase tracking-widest px-4 py-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
                        >
                          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
                          배정
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2.5">
        {dayGroups.filter(g => !g.isToday).length === 0 ? (
          <div className="text-center py-16">
            <p className="text-stone-400 text-sm mb-3">이번 주 예정된 일정이 없습니다.</p>
            <Link
              href="/admin/calendar"
              className="text-stone-500 hover:text-stone-900 text-xs inline-flex items-center gap-1 transition-colors"
            >
              캘린더에서 확인 <ArrowRight size={12} />
            </Link>
          </div>
        ) : (
          dayGroups.filter(g => !g.isToday).map(group => (
            <div key={group.date} className="border border-stone-200 bg-white overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-stone-200 flex items-center gap-3">
                <span className="text-sm font-medium text-stone-700">{group.label}</span>
                <span className="text-xs text-stone-400 ml-auto tabular-nums hidden sm:inline">{group.date}</span>
              </div>
              <div className="divide-y divide-stone-200">
                {group.checkins.map(({ reservation: r, nights }) => {
                  const channel = formatChannel(r.source);
                  return (
                    <div key={r.id + '-in'} className="px-4 sm:px-5 py-3 flex items-center gap-3">
                      <ArrowDownRight size={16} className="text-emerald-700 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-stone-900 truncate">{r.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-stone-500">{r.propertyName} · {nights}박</span>
                          {channel && (
                            <span className="text-[10px] text-stone-700 bg-stone-100 px-1.5 py-0.5 uppercase tracking-wider">
                              {channel}
                            </span>
                          )}
                          {r.phone && <span className="text-xs text-stone-400">{r.phone}</span>}
                          {!r.phone && r.email && (
                            <span className="text-xs text-stone-400 truncate max-w-[140px]">{r.email}</span>
                          )}
                        </div>
                      </div>
                      <StatusPill {...CHECKIN_BADGE} />
                    </div>
                  );
                })}
                {group.checkouts.map(({ reservation: r, cleanerName, cleaningStatus }) => {
                  const badge = STATUS_BADGE[cleaningStatus];
                  return (
                    <div key={r.id + '-out'} className="px-4 sm:px-5 py-3 flex items-center gap-3">
                      <ArrowUpRight size={16} className="text-amber-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-stone-900 truncate">{r.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-stone-500">{r.propertyName}</span>
                          {cleanerName && (
                            <>
                              <span className="text-stone-300">·</span>
                              {cleaningStatus === 'done' ? (
                                <span className="text-xs text-emerald-700 flex items-center gap-1">
                                  <Check size={11} /> {cleanerName}
                                </span>
                              ) : (
                                <span className="text-xs text-stone-500">{cleanerName}</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <StatusPill {...badge} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {dayGroups.length > 0 && (
        <div className="text-center pb-4">
          <Link
            href="/admin/calendar"
            className="text-stone-500 hover:text-stone-900 text-sm inline-flex items-center gap-1.5 transition-colors py-2"
          >
            전체 캘린더 보기 <ArrowRight size={14} />
          </Link>
        </div>
      )}
      </>)}
    </div>
  );
}
