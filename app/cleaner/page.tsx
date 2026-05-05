'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { format, parseISO, isToday, isTomorrow, isPast, differenceInCalendarDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  CheckCircle2, Clock, CalendarDays, AlertTriangle, ChevronDown, ChevronUp, Send,
  Copy, Check, Link as LinkIcon, MessageSquare, ArrowDownRight, ArrowUpRight, X, Loader2, Brush,
} from 'lucide-react';
import type { IssueCategory, IssueUrgency } from '@/lib/types';

interface CleaningTask {
  cleaningId: string;
  propertyId: string;
  propertyName: string;
  date: string;
  guestName: string;
  supplies: string;
  status: 'pending' | 'done';
  completionNote?: string;
  completedAt?: string;
  hasIssue?: boolean;
}

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
  dataSource: 'event' | 'booking';
}

interface CleaningEntry {
  id: string;
  propertyId: string;
  propertyName: string;
  date: string;
  cleanerId: string | null;
  cleanerName: string | null;
  status: 'pending' | 'done';
  isMine: boolean;
}

interface GuestMessage {
  id: string;
  text: string;
  sender: string;
  createdAt: string;
}

const ISSUE_CATEGORIES: { value: IssueCategory; label: string }[] = [
  { value: 'damage', label: '파손' },
  { value: 'malfunction', label: '고장' },
  { value: 'missing_item', label: '분실/부족' },
  { value: 'hygiene', label: '위생 문제' },
  { value: 'other', label: '기타' },
];

const URGENCY_OPTIONS: { value: IssueUrgency; label: string; color: string }[] = [
  { value: 'low', label: '낮음', color: 'text-stone-500' },
  { value: 'normal', label: '보통', color: 'text-amber-400' },
  { value: 'urgent', label: '긴급', color: 'text-red-400' },
];

export default function CleanerPage() {
  const { user, profile } = useAuth();
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [todayCheckins, setTodayCheckins] = useState<Reservation[]>([]);
  const [todayCheckouts, setTodayCheckouts] = useState<Reservation[]>([]);
  const [todayCleanings, setTodayCleanings] = useState<CleaningEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [icalToken, setIcalToken] = useState<string | null>(null);
  const [copiedIcal, setCopiedIcal] = useState(false);

  // chat dialog
  const [chatGuest, setChatGuest] = useState<Reservation | null>(null);
  const [chatMessages, setChatMessages] = useState<GuestMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);

  // completion form
  const [completionNote, setCompletionNote] = useState('');
  const [completing, setCompleting] = useState<string | null>(null);

  // issue form
  const [showIssueForm, setShowIssueForm] = useState<string | null>(null);
  const [issueCategory, setIssueCategory] = useState<IssueCategory>('other');
  const [issueTitle, setIssueTitle] = useState('');
  const [issueDesc, setIssueDesc] = useState('');
  const [issueUrgency, setIssueUrgency] = useState<IssueUrgency>('normal');
  const [submittingIssue, setSubmittingIssue] = useState(false);

  useEffect(() => {
    if (!user || !profile) return;
    loadTasks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile]);

  const loadTasks = async () => {
    if (!user || !profile) return;
    try {
      const today = format(new Date(), 'yyyy-MM-dd');

      // Fetch properties first
      const propsRes = await fetch('/api/properties');
      const propsData = await propsRes.json();
      const propNames: Record<string, string> = {};
      const propertyIds: string[] = [];
      for (const p of propsData) {
        propNames[p.id] = p.name;
        propertyIds.push(p.id);
      }
      if (propertyIds.length === 0) { setLoading(false); return; }

      const propIdsParam = propertyIds.join(',');

      // Parallel fetches
      const [meRes, cleaningsRes, cleanersRes, bookingsRes, eventsRes] = await Promise.all([
        fetch('/api/cleaners/me'),
        fetch(`/api/cleanings?propertyIds=${propIdsParam}`),
        fetch('/api/cleaners'),
        fetch(`/api/bookings?propertyIds=${propIdsParam}&status=confirmed`),
        fetch(`/api/events?propertyIds=${propIdsParam}`),
      ]);

      const meData = meRes.ok ? await meRes.json() : { cleaner: null };
      const myCleanerId: string | null = meData?.cleaner?.id ?? null;
      setIcalToken((meData?.cleaner?.publicToken as string | undefined) ?? null);

      const cleaningsData = cleaningsRes.ok ? await cleaningsRes.json() : [];
      const cleanersList = cleanersRes.ok ? await cleanersRes.json() : [];
      const bookingsData = bookingsRes.ok ? await bookingsRes.json() : [];
      const eventsData = eventsRes.ok ? await eventsRes.json() : [];

      const cleanersMap: Record<string, string> = {};
      for (const c of cleanersList as Array<{ id: string; name: string }>) {
        cleanersMap[c.id] = c.name;
      }

      // Build guest name lookup keyed by propertyId+date for cleaning matching
      const guestByKey: Record<string, string> = {};
      for (const b of bookingsData) {
        guestByKey[`${b.propertyId}_${b.checkOut}`] = b.name;
      }

      // ── My cleaning task list (existing logic) ───────────────────────
      const filteredCleanings = profile.role === 'super_admin'
        ? cleaningsData
        : myCleanerId
          ? cleaningsData.filter((c: { cleanerId?: string }) => c.cleanerId === myCleanerId)
          : [];

      const result: CleaningTask[] = filteredCleanings.map((c: Record<string, unknown>) => ({
        cleaningId: c.id as string,
        propertyId: c.propertyId as string,
        propertyName: propNames[c.propertyId as string] ?? '알 수 없는 숙소',
        date: c.date as string,
        guestName: guestByKey[`${c.propertyId}_${c.date}`] ?? '',
        supplies: (c.supplies as string) ?? '',
        status: (c.status as string) ?? 'pending',
        completionNote: c.completionNote as string | undefined,
        completedAt: c.completedAt as string | undefined,
        hasIssue: c.hasIssue as boolean | undefined,
      })).sort((a: CleaningTask, b: CleaningTask) => a.date.localeCompare(b.date));
      setTasks(result);

      // ── All cleanings on today (for "오늘의 운영" section) ─────────────
      const todayCleaningsAll: CleaningEntry[] = (cleaningsData as Array<Record<string, unknown>>)
        .filter(c => c.date === today)
        .map(c => {
          const cleanerId = (c.cleanerId as string) || null;
          // Prefer the included cleaner.name (covers other-owner cleaners);
          // fall back to cleanersMap (only same-owner colleagues).
          const includedCleaner = c.cleaner as { name?: string } | null | undefined;
          const cleanerName = cleanerId
            ? (includedCleaner?.name ?? cleanersMap[cleanerId] ?? null)
            : null;
          return {
            id: c.id as string,
            propertyId: c.propertyId as string,
            propertyName: propNames[c.propertyId as string] ?? '알 수 없는 숙소',
            date: c.date as string,
            cleanerId,
            cleanerName,
            status: ((c.status as string) === 'done' ? 'done' : 'pending') as 'done' | 'pending',
            isMine: !!myCleanerId && cleanerId === myCleanerId,
          };
        })
        .sort((a, b) => a.propertyName.localeCompare(b.propertyName));
      setTodayCleanings(todayCleaningsAll);

      // ── Today's check-ins / check-outs (events + bookings) ───────────
      const eventReservations: Reservation[] = (eventsData as Array<Record<string, unknown>>)
        .filter(e => e.type === 'reservation')
        .map(e => ({
          id: e.id as string,
          propertyId: e.propertyId as string,
          propertyName: propNames[e.propertyId as string] ?? '알 수 없는 숙소',
          title: ((e.title as string) || '').replace(/ 예약$/, ''),
          start: (e.startDate || e.start) as string,
          end: (e.endDate || e.end) as string,
          source: (e.source as string) || null,
          dataSource: 'event',
        }));
      const bookingReservations: Reservation[] = (bookingsData as Array<Record<string, unknown>>)
        .map(b => ({
          id: b.id as string,
          propertyId: b.propertyId as string,
          propertyName: propNames[b.propertyId as string] ?? '알 수 없는 숙소',
          title: (b.name as string) || '',
          start: b.checkIn as string,
          end: b.checkOut as string,
          phone: b.phone as string | undefined,
          email: b.email as string | undefined,
          guests: b.guests as number | undefined,
          source: (b.source as string) || 'direct',
          dataSource: 'booking',
        }));
      const allReservations = [...eventReservations, ...bookingReservations];
      const seen = new Set<string>();
      const uniqRes = allReservations.filter(r => {
        const key = `${r.propertyId}_${r.start}_${r.end}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });

      setTodayCheckins(uniqRes.filter(r => r.start === today));
      setTodayCheckouts(uniqRes.filter(r => r.end === today));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const openChat = async (reservation: Reservation) => {
    setChatGuest(reservation);
    if (reservation.dataSource !== 'event') {
      setChatMessages([]);
      return;
    }
    setLoadingChat(true);
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
      setChatMessages(msgs);
    } catch {
      setChatMessages([]);
    } finally {
      setLoadingChat(false);
    }
  };

  const closeChat = () => {
    setChatGuest(null);
    setChatMessages([]);
  };

  const canCompleteNow = (task: CleaningTask) => {
    const d = parseISO(task.date);
    if (!isToday(d)) return false;
    const hour = new Date().getHours();
    return hour >= 11 && hour < 16;
  };

  const completeDisabledReason = (task: CleaningTask) => {
    const d = parseISO(task.date);
    if (!isToday(d)) {
      return isPast(d)
        ? '청소 당일에만 완료 처리할 수 있습니다. (지난 일정)'
        : '청소 당일에만 완료 처리할 수 있습니다.';
    }
    return '완료 처리는 오전 11시부터 오후 4시 사이에만 가능합니다.';
  };

  const handleComplete = async (task: CleaningTask) => {
    if (!user) return;
    if (!canCompleteNow(task)) {
      alert(completeDisabledReason(task));
      return;
    }
    setCompleting(task.cleaningId);
    try {
      const res = await fetch('/api/cleanings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: task.cleaningId,
          status: 'done',
          completedAt: new Date().toISOString(),
          completionNote: completionNote || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to update');

      setTasks(prev => prev.map(t =>
        t.cleaningId === task.cleaningId
          ? { ...t, status: 'done', completedAt: new Date().toISOString(), completionNote }
          : t
      ));
      setCompletionNote('');
      setExpandedTask(null);
    } catch (err) {
      console.error(err);
      alert('완료 처리에 실패했습니다.');
    } finally {
      setCompleting(null);
    }
  };

  const handleSubmitIssue = async (task: CleaningTask) => {
    if (!user || !profile || !issueTitle.trim()) return;
    setSubmittingIssue(true);
    try {
      const issueRes = await fetch('/api/cleaning-issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cleaningId: task.cleaningId,
          propertyId: task.propertyId,
          reportedBy: user.id,
          reportedByName: profile.displayName || user.email || 'unknown',
          category: issueCategory,
          title: issueTitle.trim(),
          description: issueDesc.trim(),
          urgency: issueUrgency,
          status: 'open',
        }),
      });
      if (!issueRes.ok) throw new Error('Failed to create issue');

      await fetch('/api/cleanings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: task.cleaningId,
          hasIssue: true,
        }),
      });

      setTasks(prev => prev.map(t =>
        t.cleaningId === task.cleaningId ? { ...t, hasIssue: true } : t
      ));
      setShowIssueForm(null);
      setIssueTitle('');
      setIssueDesc('');
      setIssueCategory('other');
      setIssueUrgency('normal');
      alert('이슈가 등록되었습니다.');
    } catch (err) {
      console.error(err);
      alert('이슈 등록에 실패했습니다.');
    } finally {
      setSubmittingIssue(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-[var(--brand)] rounded-full animate-spin" />
      </div>
    );
  }

  const upcoming = tasks.filter(t => !isPast(parseISO(t.date)) || isToday(parseISO(t.date)));
  const past = tasks.filter(t => isPast(parseISO(t.date)) && !isToday(parseISO(t.date)));

  const groupByDate = (items: CleaningTask[]) => {
    const map = new Map<string, CleaningTask[]>();
    for (const t of items) {
      const arr = map.get(t.date) ?? [];
      arr.push(t);
      map.set(t.date, arr);
    }
    return Array.from(map.entries());
  };
  const upcomingGroups = groupByDate(upcoming);
  const pastGroups = groupByDate(past).reverse();

  const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

  const DateHeader = ({ dateStr, count, variant }: { dateStr: string; count: number; variant: 'upcoming' | 'past' }) => {
    const d = parseISO(dateStr);
    const todayFlag = isToday(d);
    const tomorrowFlag = isTomorrow(d);
    const weekday = WEEKDAY_KO[d.getDay()];
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const diff = differenceInCalendarDays(d, new Date());
    let badge: { text: string; cls: string } | null = null;
    if (todayFlag) badge = { text: '오늘', cls: 'bg-emerald-500 text-black' };
    else if (tomorrowFlag) badge = { text: '내일', cls: 'bg-sky-500 text-black' };
    else if (variant === 'upcoming' && diff > 0 && diff <= 7) badge = { text: `D-${diff}`, cls: 'bg-stone-100 text-stone-600' };

    const isPastVariant = variant === 'past';
    const containerCls = isPastVariant
      ? 'bg-stone-50 border-stone-300'
      : todayFlag
        ? 'bg-emerald-500/20 border-emerald-400/60 ring-1 ring-emerald-400/40'
        : tomorrowFlag
          ? 'bg-sky-500/15 border-sky-400/50'
          : 'bg-stone-100 border-stone-400';

    const dayCls = isPastVariant
      ? 'text-stone-500'
      : todayFlag
        ? 'text-emerald-200'
        : tomorrowFlag
          ? 'text-sky-200'
          : 'text-stone-900';

    const weekdayCls = isPastVariant
      ? 'text-stone-400'
      : isWeekend
        ? d.getDay() === 0
          ? 'text-rose-300'
          : 'text-sky-300'
        : 'text-stone-700';

    return (
      <div className={`sticky top-0 z-10 backdrop-blur-md border rounded-xl px-4 py-3 flex items-center gap-3 ${containerCls}`}>
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <span className={`text-3xl font-light tabular-nums tracking-tight ${dayCls}`}>
            {format(d, 'd')}
          </span>
          <span className={`text-xs tracking-widest uppercase ${weekdayCls}`}>
            {weekday}
          </span>
          <span className={`text-[11px] ${isPastVariant ? 'text-stone-500' : 'text-stone-600'}`}>
            {format(d, 'yyyy.MM')}
          </span>
        </div>
        {badge && (
          <span className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-md ${badge.cls}`}>
            {badge.text}
          </span>
        )}
        <span className={`text-[11px] tracking-widest ${isPastVariant ? 'text-stone-500' : 'text-stone-700'}`}>
          {count}건
        </span>
      </div>
    );
  };

  const TaskCard = ({ task }: { task: CleaningTask }) => {
    const isExpanded = expandedTask === task.cleaningId;
    const isIssueOpen = showIssueForm === task.cleaningId;

    return (
      <div className={`border transition-colors ${
        task.status === 'done' ? 'border-stone-100 bg-stone-50' : 'border-stone-200 bg-white'
      }`}>
        <div
          className="p-5 cursor-pointer"
          onClick={() => setExpandedTask(isExpanded ? null : task.cleaningId)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {task.status === 'done'
                  ? <CheckCircle2 size={14} className="text-green-400 shrink-0" />
                  : <Clock size={14} className="text-stone-400 shrink-0" />
                }
                <span className={`text-[10px] uppercase tracking-widest font-semibold ${
                  task.status === 'done' ? 'text-green-400' : 'text-stone-500'
                }`}>
                  {task.status === 'done' ? '완료' : '청소 예정'}
                </span>
                {task.hasIssue && (
                  <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 tracking-wider">이슈</span>
                )}
              </div>
              <p className="text-stone-900 font-medium text-sm">{task.propertyName}</p>
              {task.guestName && (
                <p className="text-stone-400 text-xs mt-1">{task.guestName} 체크아웃</p>
              )}
              {task.supplies && (
                <p className="text-stone-500 text-xs mt-2 leading-relaxed">{task.supplies}</p>
              )}
              {task.completionNote && (
                <p className="text-green-400/60 text-xs mt-2">메모: {task.completionNote}</p>
              )}
            </div>
            <div className="text-right shrink-0 flex flex-col items-end gap-2">
              {task.status === 'pending' && (
                isExpanded
                  ? <ChevronUp size={14} className="text-stone-300" />
                  : <ChevronDown size={14} className="text-stone-300" />
              )}
            </div>
          </div>
        </div>

        {/* 완료 보고 패널 */}
        {isExpanded && task.status === 'pending' && (() => {
          const canComplete = canCompleteNow(task);
          const disabledReason = canComplete ? null : completeDisabledReason(task);
          return (
          <div className="border-t border-stone-100 p-5 space-y-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-2">완료 메모 (선택)</label>
              <input
                type="text"
                value={completionNote}
                onChange={e => setCompletionNote(e.target.value)}
                placeholder="특이사항이 있으면 입력하세요"
                className="w-full bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-stone-400 transition-colors"
              />
            </div>
            {disabledReason && (
              <p className="text-[11px] text-amber-400/80 leading-relaxed">{disabledReason}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => handleComplete(task)}
                disabled={completing === task.cleaningId || !canComplete}
                title={disabledReason ?? undefined}
                className="flex-1 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white py-3 text-[11px] uppercase tracking-widest font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {completing === task.cleaningId ? (
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : (
                  <><CheckCircle2 size={14} /> 청소 완료</>
                )}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowIssueForm(isIssueOpen ? null : task.cleaningId); }}
                className="border border-amber-500/30 text-amber-400 px-4 py-3 text-[11px] uppercase tracking-widest font-semibold hover:bg-amber-500/10 transition-colors flex items-center gap-2"
              >
                <AlertTriangle size={14} /> 이슈
              </button>
            </div>

            {/* 이슈 등록 폼 */}
            {isIssueOpen && (
              <div className="border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                <p className="text-[10px] uppercase tracking-widest text-amber-400/80 font-semibold">이슈 등록</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-1.5">카테고리</label>
                    <select
                      value={issueCategory}
                      onChange={e => setIssueCategory(e.target.value as IssueCategory)}
                      className="w-full bg-white border border-stone-200 px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-stone-400"
                    >
                      {ISSUE_CATEGORIES.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-1.5">긴급도</label>
                    <select
                      value={issueUrgency}
                      onChange={e => setIssueUrgency(e.target.value as IssueUrgency)}
                      className="w-full bg-white border border-stone-200 px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-stone-400"
                    >
                      {URGENCY_OPTIONS.map(u => (
                        <option key={u.value} value={u.value}>{u.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-1.5">이슈 제목</label>
                  <input
                    type="text"
                    value={issueTitle}
                    onChange={e => setIssueTitle(e.target.value)}
                    placeholder="예: 거실 창문 균열"
                    className="w-full bg-white border border-stone-200 px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-stone-400"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-1.5">상세 설명</label>
                  <textarea
                    value={issueDesc}
                    onChange={e => setIssueDesc(e.target.value)}
                    rows={3}
                    placeholder="상세 내용을 입력하세요"
                    className="w-full bg-white border border-stone-200 px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-stone-400 resize-none"
                  />
                </div>
                <button
                  onClick={() => handleSubmitIssue(task)}
                  disabled={submittingIssue || !issueTitle.trim()}
                  className="w-full bg-amber-500 text-black py-3 text-[11px] uppercase tracking-widest font-semibold hover:bg-amber-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submittingIssue ? (
                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  ) : (
                    <><Send size={14} /> 이슈 등록</>
                  )}
                </button>
              </div>
            )}
          </div>
          );
        })()}
      </div>
    );
  };

  const icalHttpUrl = icalToken && typeof window !== 'undefined'
    ? `${window.location.origin}/c/${icalToken}/ical.ics`
    : '';
  // webcal:// triggers most calendar apps' "subscribe" flow on click.
  const icalSubscribeUrl = icalHttpUrl
    ? icalHttpUrl.replace(/^https?:/, 'webcal:')
    : '';

  const handleCopyIcal = async () => {
    if (!icalHttpUrl) return;
    try {
      await navigator.clipboard.writeText(icalHttpUrl);
      setCopiedIcal(true);
      setTimeout(() => setCopiedIcal(false), 2000);
    } catch {
      // ignore
    }
  };

  const channelLabel = (source?: string | null): string | null => {
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
  };

  return (
    <div className="space-y-10">
      <header className="border-b border-stone-200 pb-6 sm:pb-7 mt-4">
        <p className="text-[11px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">청소 담당자</p>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">
          {format(new Date(), 'M월 d일 EEEE', { locale: ko })}
        </h1>
        <p className="text-stone-500 mt-2 text-sm">오늘의 운영을 한눈에 확인하세요.</p>
      </header>

      {/* ── 오늘의 운영 ── */}
      {(todayCheckins.length > 0 || todayCheckouts.length > 0 || todayCleanings.length > 0) && (
        <section className="bg-white border border-stone-200 overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-stone-200 flex items-center gap-3">
            <p className="text-base sm:text-lg text-stone-900 font-semibold tracking-tight">오늘의 운영</p>
            <span className="ml-auto text-[10px] uppercase tracking-widest text-[var(--brand)] bg-[var(--brand-tint)] px-2.5 py-1 font-semibold">오늘</span>
          </div>

          {/* 체크인 */}
          {todayCheckins.length > 0 && (
            <div className="px-5 sm:px-6 py-4 border-b border-stone-200">
              <div className="flex items-center gap-2 mb-3">
                <ArrowDownRight size={16} className="text-emerald-700" />
                <p className="text-sm text-stone-800 font-medium">체크인</p>
                <span className="text-xs text-stone-500 tabular-nums">{todayCheckins.length}건</span>
              </div>
              <div className="space-y-px bg-stone-200">
                {todayCheckins.map(r => {
                  const ch = channelLabel(r.source);
                  return (
                    <button
                      type="button"
                      key={`in-${r.id}`}
                      onClick={() => openChat(r)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-stone-50 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-stone-900 truncate flex items-center gap-2">
                          <span className="truncate">{r.propertyName}</span>
                          {ch && (
                            <span className="text-[10px] text-stone-700 bg-stone-100 px-1.5 py-0.5 shrink-0 uppercase tracking-wider">
                              {ch}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-stone-500 mt-0.5 truncate">{r.title || '게스트'}</p>
                      </div>
                      {r.dataSource === 'event' && (
                        <MessageSquare size={14} className="text-stone-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 체크아웃 + 청소 */}
          {(todayCheckouts.length > 0 || todayCleanings.length > 0) && (
            <div className="px-5 sm:px-6 py-4">
              <div className="flex items-center gap-2 mb-3">
                <ArrowUpRight size={16} className="text-amber-600" />
                <p className="text-sm text-stone-800 font-medium">체크아웃 · 청소</p>
                <span className="text-xs text-stone-500 tabular-nums">
                  {Math.max(todayCheckouts.length, todayCleanings.length)}건
                </span>
              </div>
              <div className="space-y-px bg-stone-200">
                {todayCheckouts.map(r => {
                  const cleaning = todayCleanings.find(c => c.propertyId === r.propertyId);
                  return (
                    <button
                      type="button"
                      key={`out-${r.id}`}
                      onClick={() => openChat(r)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-stone-50 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-stone-900 truncate">{r.propertyName}</p>
                        <p className="text-xs text-stone-500 mt-0.5 flex items-center gap-1.5">
                          {r.title && <span>{r.title}</span>}
                          {cleaning?.cleanerName && (
                            <>
                              <span className="text-stone-300">·</span>
                              <Brush size={11} className={cleaning.isMine ? 'text-[var(--brand)]' : 'text-stone-400'} />
                              <span className={cleaning.isMine ? 'text-[var(--brand-dark)] font-medium' : ''}>
                                {cleaning.cleanerName}
                                {cleaning.isMine && ' (나)'}
                              </span>
                            </>
                          )}
                          {!cleaning?.cleanerName && (
                            <>
                              <span className="text-stone-300">·</span>
                              <span className="text-rose-600">미배정</span>
                            </>
                          )}
                        </p>
                      </div>
                      {cleaning?.status === 'done' && (
                        <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                      )}
                      {r.dataSource === 'event' && cleaning?.status !== 'done' && (
                        <MessageSquare size={14} className="text-stone-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
                {/* Cleanings without matching checkouts (manual cleanings) */}
                {todayCleanings
                  .filter(c => !todayCheckouts.some(r => r.propertyId === c.propertyId))
                  .map(c => (
                    <div
                      key={`only-cleaning-${c.id}`}
                      className="flex items-center gap-3 px-4 py-3 bg-white"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-stone-900 truncate">{c.propertyName}</p>
                        <p className="text-xs text-stone-500 mt-0.5 flex items-center gap-1.5">
                          <Brush size={11} className={c.isMine ? 'text-[var(--brand)]' : 'text-stone-400'} />
                          <span className={c.isMine ? 'text-[var(--brand-dark)] font-medium' : ''}>
                            {c.cleanerName ?? '미배정'}
                            {c.isMine && ' (나)'}
                          </span>
                        </p>
                      </div>
                      {c.status === 'done' && (
                        <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </section>
      )}

      {icalToken && (
        <section className="border border-stone-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CalendarDays size={14} className="text-stone-500" />
            <h2 className="text-[11px] uppercase tracking-widest text-stone-600 font-medium">캘린더 연동</h2>
          </div>
          <p className="text-xs text-stone-500 leading-relaxed">
            아래 링크를 본인의 캘린더 앱(구글, 애플, 네이버)에 추가하면 배정된 청소 일정이 자동으로 동기화됩니다.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={icalSubscribeUrl}
              className="inline-flex items-center gap-1.5 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white px-4 py-2.5 text-[11px] uppercase tracking-widest font-semibold transition-colors"
            >
              <LinkIcon size={12} /> 캘린더에 추가
            </a>
            <button
              type="button"
              onClick={handleCopyIcal}
              className="inline-flex items-center gap-1.5 border border-stone-300 text-stone-700 hover:text-stone-900 hover:border-stone-400 px-4 py-2.5 text-[11px] uppercase tracking-widest font-semibold transition-colors"
            >
              {copiedIcal ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
              {copiedIcal ? '복사됨' : '주소 복사'}
            </button>
          </div>

          <input
            type="text"
            readOnly
            value={icalHttpUrl}
            onFocus={e => e.currentTarget.select()}
            className="w-full bg-stone-50 border border-stone-200 px-3 py-2 text-[11px] text-stone-700 font-mono focus:outline-none focus:border-stone-400 truncate"
          />

          <details className="text-[11px] text-stone-500">
            <summary className="cursor-pointer hover:text-stone-700 transition-colors">앱별 추가 방법</summary>
            <div className="mt-2 space-y-1.5 pl-3 leading-relaxed">
              <p><span className="text-stone-700">구글 캘린더</span> — 다른 캘린더 + → URL로 추가 → 위 주소 붙여넣기</p>
              <p><span className="text-stone-700">애플(iPhone) 캘린더</span> — "캘린더에 추가" 버튼 누르고 안내대로 진행</p>
              <p><span className="text-stone-700">네이버 캘린더</span> — 설정 → 외부 캘린더 → URL 추가</p>
            </div>
          </details>
        </section>
      )}

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center text-stone-400 py-16">
          <CalendarDays size={32} className="mb-4 opacity-50" />
          <p className="text-sm">배정된 청소 일정이 없습니다.</p>
        </div>
      ) : (
        <>
          {upcomingGroups.length > 0 && (
            <section className="space-y-6">
              <h2 className="text-[10px] uppercase tracking-widest text-stone-400">예정된 일정 ({upcoming.length})</h2>
              {upcomingGroups.map(([dateStr, items]) => (
                <div key={dateStr} className="space-y-2">
                  <DateHeader dateStr={dateStr} count={items.length} variant="upcoming" />
                  <div className="space-y-2 pl-1">
                    {items.map(t => <TaskCard key={t.cleaningId} task={t} />)}
                  </div>
                </div>
              ))}
            </section>
          )}
          {pastGroups.length > 0 && (
            <section className="space-y-6">
              <h2 className="text-[10px] uppercase tracking-widest text-stone-400">지난 일정 ({past.length})</h2>
              {pastGroups.map(([dateStr, items]) => (
                <div key={dateStr} className="space-y-2">
                  <DateHeader dateStr={dateStr} count={items.length} variant="past" />
                  <div className="space-y-2 pl-1 opacity-75">
                    {items.map(t => <TaskCard key={t.cleaningId} task={t} />)}
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {/* Chat dialog */}
      {chatGuest && (
        <div
          className="fixed inset-0 bg-stone-950/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={closeChat}
        >
          <div
            className="bg-white border border-stone-200 w-full sm:max-w-xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 sm:px-6 py-5 border-b border-stone-200 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <p className="text-xs text-stone-500">{chatGuest.propertyName}</p>
                  {channelLabel(chatGuest.source) && (
                    <span className="text-[10px] text-stone-700 bg-stone-100 px-1.5 py-0.5 uppercase tracking-wider">
                      {channelLabel(chatGuest.source)}
                    </span>
                  )}
                </div>
                <p className="text-lg text-stone-900 font-semibold truncate">
                  {chatGuest.title || '게스트'}
                </p>
                <div className="flex items-center gap-2.5 mt-2 text-xs text-stone-500 flex-wrap">
                  <span>
                    {format(parseISO(chatGuest.start), 'M월 d일 (EEE)', { locale: ko })} 체크인
                  </span>
                  <span className="text-stone-300">·</span>
                  <span>
                    {format(parseISO(chatGuest.end), 'M월 d일 (EEE)', { locale: ko })} 체크아웃
                  </span>
                </div>
              </div>
              <button
                onClick={closeChat}
                className="text-stone-500 hover:text-stone-900 transition-colors shrink-0 p-1"
                aria-label="닫기"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 bg-stone-50">
              {loadingChat ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={20} className="animate-spin text-[var(--brand)]" />
                </div>
              ) : chatMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                  <MessageSquare size={22} className="text-stone-300" />
                  <p className="text-sm text-stone-500">
                    {chatGuest.dataSource === 'event'
                      ? '주고받은 메시지가 없습니다.'
                      : '직접 예약은 대화 내역이 없습니다.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {chatMessages.map(m => {
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
          </div>
        </div>
      )}
    </div>
  );
}
