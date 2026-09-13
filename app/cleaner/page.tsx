'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import LaundryWorkspace from '@/components/LaundryWorkspace';
import { todayKst } from '@/lib/dates';
import { useAuth } from '@/components/AuthProvider';
import { format, parseISO, isToday, isTomorrow, isPast, differenceInCalendarDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  CheckCircle2, Clock, CalendarDays, AlertTriangle, ChevronDown, ChevronUp, Send,
  MessageSquare, X, Loader2,
} from 'lucide-react';
import type { IssueCategory, IssueUrgency } from '@/lib/types';
import { toast, Skeleton, SkeletonCard, PullToRefresh } from '@/components/ui';
import { useRefetchOnReturn } from '@/lib/hooks/useRefetchOnReturn';

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
  adults?: number;
  children?: number;
  pets?: number;
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

function ArrivalDetails({reservation:r}:{reservation:Reservation}) {
  const nights = differenceInCalendarDays(parseISO(r.end),parseISO(r.start));
  return <div className="mt-2 space-y-1 text-sm text-stone-700">
    <p className="font-medium">{r.guests != null && r.guests > 0 ? `${r.guests}명` : '인원 미확인'} · {nights>0?`${nights}박 ${nights+1}일`:'숙박 기간 미확인'}</p>
    {r.adults != null && <p className="text-xs text-stone-500">성인 {r.adults}명{r.children != null?` · 아동 ${r.children}명`:''}</p>}
    <p className="text-xs">{format(parseISO(r.start),'M월 d일')} 입실 → {format(parseISO(r.end),'M월 d일')} 퇴실</p>
    <p className={r.pets ? 'font-medium text-amber-800' : 'text-stone-500'}>{r.pets == null?'반려견 옵션 미확인':r.pets===0?'반려견 동반 없음':`반려견 ${r.pets}마리 동반`}</p>
  </div>;
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
  { value: 'normal', label: '보통', color: 'text-amber-800' },
  { value: 'urgent', label: '긴급', color: 'text-red-400' },
];

export default function CleanerPage() {
  const { user, profile } = useAuth();
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [todayCheckins, setTodayCheckins] = useState<Reservation[]>([]);
  const [todayCheckouts, setTodayCheckouts] = useState<Reservation[]>([]);
  const [todayCleanings, setTodayCleanings] = useState<CleaningEntry[]>([]);
  // 오늘 체크아웃 확인 상태 (숙소별): 게스트 셀프 체크아웃 또는 호스트 확인
  const [checkoutToday, setCheckoutToday] = useState<Record<string, { confirmed: boolean; confirmedAt: string | null; confirmedBy: string | null }>>({});
  const [today, setToday] = useState(todayKst);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

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
      // 화면 전용 API 한 번. 이전에는 6번 호출(기간 제한 없음)에 9초까지 걸렸다.
      const res = await fetch('/api/cleaner/today');
      if (!res.ok) throw new Error(`today ${res.status}`);
      const data = await res.json();
      setTasks(((data.tasks ?? []) as CleaningTask[]).slice().sort((a, b) => a.date.localeCompare(b.date)));
      setToday(data.today || todayKst());
      setTodayCleanings((data.todayCleanings ?? []) as CleaningEntry[]);
      setTodayCheckins((data.checkins ?? []) as Reservation[]);
      setTodayCheckouts((data.checkouts ?? []) as Reservation[]);
      setCheckoutToday(data.checkoutToday ?? {}); setLoadError('');
    } catch (err) {
      console.error(err);
      setLoadError('일정을 불러오지 못했습니다. 표시된 내용은 최신 정보가 아닐 수 있습니다.');
    } finally {
      setLoading(false);
    }
  };
  // 탭에 돌아오면(몇 시간 뒤 다시 열었을 때) 최신으로.
  useRefetchOnReturn(loadTasks);

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
      toast.info(completeDisabledReason(task));
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
      setTodayCleanings(prev => prev.map(c => c.id === task.cleaningId ? {...c, status: 'done'} : c));
      setCompletionNote('');
      setExpandedTask(null);
      toast.success('청소 완료로 기록했습니다.');
    } catch (err) {
      console.error(err);
      toast.error('완료 처리에 실패했습니다.');
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
      toast.success('이슈를 등록했습니다.');
    } catch (err) {
      console.error(err);
      toast.error('이슈 등록에 실패했습니다.');
    } finally {
      setSubmittingIssue(false);
    }
  };

  if (loading) {
    // 전체 화면 스피너 대신 화면 골격을 먼저 보여준다.
    return (
      <div className="space-y-8">
        <header className="border-b border-stone-200 pb-6 mt-4">
          <p className="t-label text-[var(--brand)] mb-2">청소 담당자</p>
          <h1 className="t-display text-stone-900">{format(new Date(), 'M월 d일 EEEE', { locale: ko })}</h1>
          <Skeleton className="h-4 w-40 mt-3" />
        </header>
        <SkeletonCard rows={3} />
        <SkeletonCard rows={2} />
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
          <span className={`text-[13px] ${isPastVariant ? 'text-stone-500' : 'text-stone-600'}`}>
            {format(d, 'yyyy.MM')}
          </span>
        </div>
        {badge && (
          <span className={`text-[12px] font-bold tracking-widest px-2 py-1 rounded-md ${badge.cls}`}>
            {badge.text}
          </span>
        )}
        <span className={`text-[13px] tracking-widest ${isPastVariant ? 'text-stone-500' : 'text-stone-700'}`}>
          {count}건
        </span>
      </div>
    );
  };

  const TaskCard = ({ task, embedded = false }: { task: CleaningTask; embedded?: boolean }) => {
    const isExpanded = expandedTask === task.cleaningId;
    const isIssueOpen = showIssueForm === task.cleaningId;


    return (
      <div className={`border transition-colors ${
        task.status === 'done' ? 'border-stone-100 bg-stone-50' : 'border-stone-200 bg-white'
      }`}>
        <button
          type="button" aria-expanded={isExpanded}
          className="w-full text-left p-5 min-h-16"
          onClick={() => setExpandedTask(isExpanded ? null : task.cleaningId)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {task.status === 'done'
                  ? <CheckCircle2 size={14} className="text-emerald-700 shrink-0" />
                  : <Clock size={14} className="text-stone-400 shrink-0" />
                }
                <span className={`text-[12px] uppercase tracking-widest font-semibold ${
                  task.status === 'done' ? 'text-emerald-700' : 'text-stone-500'
                }`}>
                  {task.status === 'done' ? '청소 완료' : embedded ? '청소 완료 보고 · 문제 신고' : '청소 예정'}
                </span>
                {task.hasIssue && (
                  <span className="text-[12px] bg-red-500/20 text-red-400 px-1.5 py-0.5 tracking-wider">이슈</span>
                )}
              </div>
              {!embedded && <p className="text-stone-900 font-medium text-sm">{task.propertyName}</p>}
              {!embedded && task.guestName && (
                <p className="text-stone-600 text-sm mt-1">{task.guestName} 체크아웃</p>
              )}
              {task.supplies && (
                <p className="text-stone-500 text-xs mt-2 leading-relaxed">{task.supplies}</p>
              )}
              {task.completionNote && (
                <p className="text-emerald-700 text-xs mt-2">메모: {task.completionNote}</p>
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
        </button>

        {/* 완료 보고 패널 */}
        {isExpanded && task.status === 'pending' && (() => {
          const canComplete = canCompleteNow(task);
          const disabledReason = canComplete ? null : completeDisabledReason(task);
          return (
          <div className="border-t border-stone-100 p-5 space-y-4">
            <div>
              <label className="block text-[12px] uppercase tracking-widest text-stone-400 mb-2">완료 메모 (선택)</label>
              <input
                type="text"
                value={completionNote}
                onChange={e => setCompletionNote(e.target.value)}
                placeholder="특이사항이 있으면 입력하세요"
                className="w-full bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-stone-400 transition-colors"
              />
            </div>
            {disabledReason && (
              <p className="text-[13px] text-amber-800 leading-relaxed">{disabledReason}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => handleComplete(task)}
                disabled={completing === task.cleaningId || !canComplete}
                title={disabledReason ?? undefined}
                className="flex-1 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white py-3 text-[13px] uppercase tracking-widest font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {completing === task.cleaningId ? (
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : (
                  <><CheckCircle2 size={14} /> 청소 완료</>
                )}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowIssueForm(isIssueOpen ? null : task.cleaningId); }}
                className="border border-amber-500/30 text-amber-800 px-4 py-3 text-[13px] uppercase tracking-widest font-semibold hover:bg-amber-500/10 transition-colors flex items-center gap-2"
              >
                <AlertTriangle size={14} /> 이슈
              </button>
            </div>

            {/* 이슈 등록 폼 */}
            {isIssueOpen && (
              <div className="border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                <p className="text-[12px] uppercase tracking-widest text-amber-800 font-semibold">이슈 등록</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] uppercase tracking-widest text-stone-400 mb-1.5">카테고리</label>
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
                    <label className="block text-[12px] uppercase tracking-widest text-stone-400 mb-1.5">긴급도</label>
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
                  <label className="block text-[12px] uppercase tracking-widest text-stone-400 mb-1.5">이슈 제목</label>
                  <input
                    type="text"
                    value={issueTitle}
                    onChange={e => setIssueTitle(e.target.value)}
                    placeholder="예: 거실 창문 균열"
                    className="w-full bg-white border border-stone-200 px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-stone-400"
                  />
                </div>
                <div>
                  <label className="block text-[12px] uppercase tracking-widest text-stone-400 mb-1.5">상세 설명</label>
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
                  className="w-full bg-amber-500 text-black py-3 text-[13px] uppercase tracking-widest font-semibold hover:bg-amber-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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

  const propertyIds = [...new Set([...todayCheckins, ...todayCheckouts, ...todayCleanings, ...tasks.filter(t=>t.date===today)].map(r=>r.propertyId))];
  const operations = propertyIds.map(propertyId => {
    const arrivals = todayCheckins.filter(r=>r.propertyId===propertyId);
    const departures = todayCheckouts.filter(r=>r.propertyId===propertyId);
    const cleanings = todayCleanings.filter(c=>c.propertyId===propertyId);
    const ownTasks = tasks.filter(t=>t.date===today&&t.propertyId===propertyId);
    const completed = cleanings.length>0 && cleanings.every(c=>c.status==='done');
    const priority = arrivals.length && !completed ? 0 : completed ? 2 : 1;
    const name = (arrivals[0] || departures[0] || cleanings[0] || ownTasks[0]).propertyName;
    return {propertyId, name, arrivals, departures, cleanings, ownTasks, completed, priority};
  }).sort((a,b)=>a.priority-b.priority || a.name.localeCompare(b.name,'ko'));

  return (
    <PullToRefresh onRefresh={loadTasks}>
    <div className="space-y-10 pb-nav">
      <header className="border-b border-stone-200 pb-6 sm:pb-7 mt-4">
        <p className="t-label text-[var(--brand)] mb-2">청소 담당자</p>
        <h1 className="t-display text-stone-900">
          {format(new Date(), 'M월 d일 EEEE', { locale: ko })}
        </h1>
        <p className="text-stone-500 mt-2 t-caption">청소부터 세탁 입고까지, 오늘 할 일을 한곳에서 확인하세요.</p>
      </header>

      {loadError && <div role="alert" className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-sm"><p>{loadError}</p><button type="button" onClick={loadTasks} className="min-h-12 underline font-medium">다시 불러오기</button></div>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[['남은 청소',tasks.filter(t=>t.date===today&&t.status!=='done').length,'#today-cleaning'],['청소 완료',tasks.filter(t=>t.date===today&&t.status==='done').length,'#today-cleaning'],['퇴실 확인 대기',todayCheckouts.filter(r=>!checkoutToday[r.propertyId]?.confirmed).length,'#today-cleaning'],['오늘 입실',todayCheckins.length,'#today-cleaning']].map(([label,count,href])=><a key={label} href={String(href)} className="rounded-2xl border border-stone-200 bg-white p-4"><p className="text-xs text-stone-500">{label}</p><p className="text-2xl font-semibold mt-2">{count}<span className="text-xs font-normal ml-1">건</span></p></a>)}
      </div>
      <nav className="flex gap-2 flex-wrap text-sm" aria-label="업무 바로가기"><a href="#today-laundry" className="min-h-11 rounded-xl bg-stone-900 text-white px-4 py-3">세탁 수거·입고</a>{[['/cleaner/calendar','이번 달 일정'],['/cleaner/supplies','비품 관리'],['/cleaner/issues','문제 신고']].map(([href,label])=><Link key={href} href={href} className="min-h-11 rounded-xl border px-4 py-3 bg-white">{label}</Link>)}</nav>
      <section id="today-cleaning" className="space-y-4 scroll-mt-6" aria-label="숙소별 오늘 업무">
        <div><h2 className="text-xl font-semibold">숙소별 오늘 업무</h2><p className="text-sm text-stone-500 mt-1">오늘 입실을 앞두고 청소가 남은 숙소부터 표시합니다.</p></div>
        {operations.map(op=><details key={op.propertyId} open={!op.completed} className="group rounded-2xl border border-stone-200 bg-white overflow-hidden">
          <summary className="cursor-pointer p-5 marker:text-stone-400"><span className="font-semibold">{op.name}</span><span className={`ml-3 text-xs ${op.completed?'text-emerald-700':op.priority===0?'text-amber-800':'text-stone-500'}`}>{op.completed?'청소 완료':op.cleanings.length?'청소 대기':'청소 일정 미등록'}{op.arrivals.length?' · 오늘 입실':''}</span>
            {op.completed&&<span className="block mt-2 text-xs text-stone-500">{op.arrivals.length?op.arrivals.map(r=>`${r.guests || '인원 미확인'}${r.guests?'명':''} · ${differenceInCalendarDays(parseISO(r.end),parseISO(r.start))}박`).join(' / '):'오늘 입실 없음'} · 펼쳐서 상세 보기</span>}
          </summary>
          <div className="px-5 pb-5 space-y-4 border-t border-stone-100">
            <section className="pt-4"><h3 className="text-xs font-semibold text-stone-500 mb-2">퇴실</h3>
              {op.departures.map(r=><p key={r.id} className="text-sm">{r.title || '게스트'}</p>)}
              {checkoutToday[op.propertyId]?.confirmed?<p className="text-sm text-emerald-700">퇴실 확인 완료{checkoutToday[op.propertyId].confirmedAt&&` · ${format(parseISO(checkoutToday[op.propertyId].confirmedAt!), 'HH:mm')}`}</p>:<p className="text-sm text-amber-800">{op.departures.length?'퇴실 확인 대기 · 확인 전에는 들어가지 마세요.':'오늘 퇴실 예약 정보 없음 · 출입 전 확인해주세요.'}</p>}
            </section>
            <section className="border-t border-stone-100 pt-4 space-y-2"><h3 className="text-xs font-semibold text-stone-500">청소</h3>
              {op.cleanings.length?op.cleanings.map(c=><p key={c.id} className="text-sm">{c.cleanerName || '담당자 미배정'}{c.isMine?' (나)':''} · {c.status==='done'?'완료':'대기'}</p>):<p className="text-sm text-amber-800">등록된 청소 일정이 없습니다.</p>}
              {op.ownTasks.map(t=><TaskCard key={t.cleaningId} task={t} embedded/>)}
            </section>
            <section className="border-t border-stone-100 pt-4"><h3 className="text-xs font-semibold text-stone-500 mb-2">입실</h3>
              {op.arrivals.length?op.arrivals.map(r=><div key={r.id} className="py-2"><p className="text-sm font-medium">{r.title || '게스트'} <span className="font-normal text-xs text-stone-500">{channelLabel(r.source)}</span></p><ArrivalDetails reservation={r}/>{r.dataSource==='event'&&<button type="button" onClick={()=>openChat(r)} className="mt-3 min-h-11 rounded-xl border px-4 text-sm">입실 예약 대화</button>}</div>):<p className="text-sm text-stone-500">오늘 입실 예정 예약이 없습니다.</p>}
              {op.departures.filter(r=>r.dataSource==='event').map(r=><button type="button" key={r.id} onClick={()=>openChat(r)} className="mt-2 mr-2 min-h-11 rounded-xl border px-4 text-sm">퇴실 예약 대화</button>)}
            </section>
          </div>
        </details>)}
        {!loadError&&!operations.length&&<p className="rounded-xl bg-white border p-5 text-sm text-stone-500">오늘 등록된 청소·입실·퇴실 일정이 없습니다.</p>}
      </section>
      <section id="today-laundry" className="scroll-mt-6 rounded-2xl bg-stone-50 border border-stone-200 p-4 sm:p-6"><LaundryWorkspace embedded /></section>
      {loadError && tasks.length === 0 ? null : tasks.length === 0 ? (
        <div className="flex flex-col items-center text-stone-400 py-16">
          <CalendarDays size={32} className="mb-4 opacity-50" />
          <p className="text-sm">배정된 청소 일정이 없습니다.</p>
        </div>
      ) : (
        <>
          {upcomingGroups.length > 0 && (
            <details className="space-y-4"><summary className="cursor-pointer py-3 font-medium">앞으로의 청소 일정</summary>
              {upcomingGroups.filter(([dateStr]) => dateStr !== today).map(([dateStr, items]) => (
                <div key={dateStr} className="space-y-2">
                  <DateHeader dateStr={dateStr} count={items.length} variant="upcoming" />
                  <div className="space-y-2 pl-1">
                    {items.map(t => <TaskCard key={t.cleaningId} task={t} />)}
                  </div>
                </div>
              ))}
            </details>
          )}
          {pastGroups.length > 0 && (
            <details className="space-y-4"><summary className="cursor-pointer py-3 font-medium">지난 청소 일정 ({past.length})</summary>
              {pastGroups.map(([dateStr, items]) => (
                <div key={dateStr} className="space-y-2">
                  <DateHeader dateStr={dateStr} count={items.length} variant="past" />
                  <div className="space-y-2 pl-1 opacity-75">
                    {items.map(t => <TaskCard key={t.cleaningId} task={t} />)}
                  </div>
                </div>
              ))}
            </details>
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
                    <span className="text-[12px] text-stone-700 bg-stone-100 px-1.5 py-0.5 uppercase tracking-wider">
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
                          <p className={`text-[12px] mt-1 ${isGuest ? 'text-stone-400' : 'text-white/70'}`}>
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
    </PullToRefresh>
  );
}
