'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { format, parseISO, isToday, isTomorrow, isPast, differenceInCalendarDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CheckCircle2, Clock, CalendarDays, AlertTriangle, ChevronDown, ChevronUp, Send } from 'lucide-react';
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

const ISSUE_CATEGORIES: { value: IssueCategory; label: string }[] = [
  { value: 'damage', label: '파손' },
  { value: 'malfunction', label: '고장' },
  { value: 'missing_item', label: '분실/부족' },
  { value: 'hygiene', label: '위생 문제' },
  { value: 'other', label: '기타' },
];

const URGENCY_OPTIONS: { value: IssueUrgency; label: string; color: string }[] = [
  { value: 'low', label: '낮음', color: 'text-white/50' },
  { value: 'normal', label: '보통', color: 'text-amber-400' },
  { value: 'urgent', label: '긴급', color: 'text-red-400' },
];

export default function CleanerPage() {
  const { user, profile } = useAuth();
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

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
      // Fetch properties
      const propsRes = await fetch('/api/properties');
      const propsData = await propsRes.json();
      const propNames: Record<string, string> = {};
      const propertyIds: string[] = [];
      for (const p of propsData) {
        propNames[p.id] = p.name;
        propertyIds.push(p.id);
      }
      if (propertyIds.length === 0) { setLoading(false); return; }

      // Resolve logged-in user's Cleaner record (null for admins without one)
      const meRes = await fetch('/api/cleaners/me');
      const meData = meRes.ok ? await meRes.json() : { cleaner: null };
      const myCleanerId: string | null = meData?.cleaner?.id ?? null;

      // Fetch cleanings
      const cleaningsRes = await fetch(`/api/cleanings?propertyIds=${propertyIds.join(',')}`);
      const cleaningsData = await cleaningsRes.json();

      // Filter by cleanerId if not super_admin
      const filteredCleanings = profile.role === 'super_admin'
        ? cleaningsData
        : myCleanerId
          ? cleaningsData.filter((c: { cleanerId?: string }) => c.cleanerId === myCleanerId)
          : [];

      // Fetch bookings for guest names
      const bookingsRes = await fetch(`/api/bookings?propertyIds=${propertyIds.join(',')}&status=confirmed`);
      const bookingsData = await bookingsRes.json();
      const guestByKey: Record<string, string> = {};
      for (const b of bookingsData) {
        guestByKey[`${b.propertyId}_${b.checkOut}`] = b.name;
      }

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
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async (task: CleaningTask) => {
    if (!user) return;
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
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin" />
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
    else if (variant === 'upcoming' && diff > 0 && diff <= 7) badge = { text: `D-${diff}`, cls: 'bg-white/10 text-white/70' };

    const isPastVariant = variant === 'past';
    const containerCls = isPastVariant
      ? 'bg-white/[0.06] border-white/20'
      : todayFlag
        ? 'bg-emerald-500/20 border-emerald-400/60 ring-1 ring-emerald-400/40'
        : tomorrowFlag
          ? 'bg-sky-500/15 border-sky-400/50'
          : 'bg-white/10 border-white/30';

    const dayCls = isPastVariant
      ? 'text-white/60'
      : todayFlag
        ? 'text-emerald-200'
        : tomorrowFlag
          ? 'text-sky-200'
          : 'text-white';

    const weekdayCls = isPastVariant
      ? 'text-white/40'
      : isWeekend
        ? d.getDay() === 0
          ? 'text-rose-300'
          : 'text-sky-300'
        : 'text-white/80';

    return (
      <div className={`sticky top-0 z-10 backdrop-blur-md border rounded-xl px-4 py-3 flex items-center gap-3 ${containerCls}`}>
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <span className={`text-3xl font-light tabular-nums tracking-tight ${dayCls}`}>
            {format(d, 'd')}
          </span>
          <span className={`text-xs tracking-widest uppercase ${weekdayCls}`}>
            {weekday}
          </span>
          <span className={`text-[11px] ${isPastVariant ? 'text-white/50' : 'text-white/70'}`}>
            {format(d, 'yyyy.MM')}
          </span>
        </div>
        {badge && (
          <span className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-md ${badge.cls}`}>
            {badge.text}
          </span>
        )}
        <span className={`text-[11px] tracking-widest ${isPastVariant ? 'text-white/50' : 'text-white/80'}`}>
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
        task.status === 'done' ? 'border-white/5 bg-[#0a0a0a]' : 'border-white/10 bg-[#111]'
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
                  : <Clock size={14} className="text-white/40 shrink-0" />
                }
                <span className={`text-[10px] uppercase tracking-widest font-semibold ${
                  task.status === 'done' ? 'text-green-400' : 'text-white/50'
                }`}>
                  {task.status === 'done' ? '완료' : '청소 예정'}
                </span>
                {task.hasIssue && (
                  <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 tracking-wider">이슈</span>
                )}
              </div>
              <p className="text-white font-medium text-sm">{task.propertyName}</p>
              {task.guestName && (
                <p className="text-white/40 text-xs mt-1">{task.guestName} 체크아웃</p>
              )}
              {task.supplies && (
                <p className="text-white/50 text-xs mt-2 leading-relaxed">{task.supplies}</p>
              )}
              {task.completionNote && (
                <p className="text-green-400/60 text-xs mt-2">메모: {task.completionNote}</p>
              )}
            </div>
            <div className="text-right shrink-0 flex flex-col items-end gap-2">
              {task.status === 'pending' && (
                isExpanded
                  ? <ChevronUp size={14} className="text-white/30" />
                  : <ChevronDown size={14} className="text-white/30" />
              )}
            </div>
          </div>
        </div>

        {/* 완료 보고 패널 */}
        {isExpanded && task.status === 'pending' && (
          <div className="border-t border-white/5 p-5 space-y-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">완료 메모 (선택)</label>
              <input
                type="text"
                value={completionNote}
                onChange={e => setCompletionNote(e.target.value)}
                placeholder="특이사항이 있으면 입력하세요"
                className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleComplete(task)}
                disabled={completing === task.cleaningId}
                className="flex-1 bg-white text-black py-3 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">카테고리</label>
                    <select
                      value={issueCategory}
                      onChange={e => setIssueCategory(e.target.value as IssueCategory)}
                      className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
                    >
                      {ISSUE_CATEGORIES.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">긴급도</label>
                    <select
                      value={issueUrgency}
                      onChange={e => setIssueUrgency(e.target.value as IssueUrgency)}
                      className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
                    >
                      {URGENCY_OPTIONS.map(u => (
                        <option key={u.value} value={u.value}>{u.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">이슈 제목</label>
                  <input
                    type="text"
                    value={issueTitle}
                    onChange={e => setIssueTitle(e.target.value)}
                    placeholder="예: 거실 창문 균열"
                    className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">상세 설명</label>
                  <textarea
                    value={issueDesc}
                    onChange={e => setIssueDesc(e.target.value)}
                    rows={3}
                    placeholder="상세 내용을 입력하세요"
                    className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 resize-none"
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
        )}
      </div>
    );
  };

  return (
    <div className="space-y-10">
      <header className="border-b border-white/10 pb-6 mt-4">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-2">청소 담당자</p>
        <h1 className="text-2xl font-light tracking-tight text-white">내 청소 일정</h1>
      </header>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center text-white/40 py-16">
          <CalendarDays size={32} className="mb-4 opacity-50" />
          <p className="text-sm">배정된 청소 일정이 없습니다.</p>
        </div>
      ) : (
        <>
          {upcomingGroups.length > 0 && (
            <section className="space-y-6">
              <h2 className="text-[10px] uppercase tracking-widest text-white/40">예정된 일정 ({upcoming.length})</h2>
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
              <h2 className="text-[10px] uppercase tracking-widest text-white/40">지난 일정 ({past.length})</h2>
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
    </div>
  );
}
