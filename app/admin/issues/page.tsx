'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, Clock, ArrowRight } from 'lucide-react';
import type { CleaningIssue, IssueStatus } from '@/lib/types';
import { ISSUE_CATEGORY_LABELS, URGENCY_LABELS, ISSUE_STATUS_CONFIG, ISSUE_NEXT_STATUS } from '@/lib/constants';
import { fetchPropertyNames, enrichWithPropertyName, apiPut } from '@/lib/api-client';

export default function AdminIssuesPage() {
  const { user, profile } = useAuth();
  const [issues, setIssues] = useState<(CleaningIssue & { propertyName: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [resolveNote, setResolveNote] = useState<Record<string, string>>({});
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !profile) return;
    loadIssues();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile]);

  const loadIssues = async () => {
    if (!user || !profile) return;
    try {
      const [propNames, issuesData] = await Promise.all([
        fetchPropertyNames(),
        fetch('/api/cleaning-issues').then(r => r.json()) as Promise<CleaningIssue[]>,
      ]);

      const result = enrichWithPropertyName(issuesData, propNames).sort((a, b) => {
        const urgOrder: Record<string, number> = { urgent: 0, normal: 1, low: 2 };
        const statusOrder: Record<string, number> = { open: 0, in_progress: 1, resolved: 2, closed: 3 };
        if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
        if (urgOrder[a.urgency] !== urgOrder[b.urgency]) return urgOrder[a.urgency] - urgOrder[b.urgency];
        return b.createdAt.localeCompare(a.createdAt);
      });

      setIssues(result);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (issue: CleaningIssue & { propertyName: string }) => {
    if (!user) return;
    const nextStatus = ISSUE_NEXT_STATUS[issue.status];
    if (!nextStatus) return;

    setUpdating(issue.id);
    try {
      const updateData: Record<string, unknown> = { id: issue.id, status: nextStatus };
      if (nextStatus === 'resolved') {
        updateData.resolvedBy = user.id;
        updateData.resolvedAt = new Date().toISOString();
        updateData.resolvedNote = resolveNote[issue.id] || null;
      }
      await apiPut('/api/cleaning-issues', updateData);
      setIssues(prev => prev.map(i =>
        i.id === issue.id ? { ...i, status: nextStatus, ...updateData } as typeof i : i
      ));
    } catch (err) {
      console.error(err);
      alert('상태 변경에 실패했습니다.');
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 border-t-2 border-[var(--brand)] rounded-full animate-spin" /></div>;
  }

  const filtered = issues.filter(i => {
    if (filter === 'open') return i.status === 'open' || i.status === 'in_progress';
    if (filter === 'resolved') return i.status === 'resolved' || i.status === 'closed';
    return true;
  });

  const openCount = issues.filter(i => i.status === 'open' || i.status === 'in_progress').length;

  return (
    <div className="max-w-3xl mx-auto space-y-6 sm:space-y-8">
      <header className="border-b border-stone-200 pb-5 sm:pb-6">
        <p className="text-[10px] tracking-[0.3em] text-stone-500 mb-3">관리</p>
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-stone-900">이슈 관리</h1>
        {openCount > 0 && (
          <p className="text-amber-600 text-sm mt-2">{openCount}건의 미해결 이슈</p>
        )}
      </header>

      {/* Filter */}
      <div className="flex gap-2">
        {[
          { key: 'all', label: '전체' },
          { key: 'open', label: '미해결' },
          { key: 'resolved', label: '해결됨' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as typeof filter)}
            className={`px-4 py-2.5 text-[11px] uppercase tracking-widest font-semibold transition-colors ${
              filter === f.key ? 'bg-[var(--brand)] text-white' : 'border border-stone-200 text-stone-500 hover:text-stone-900'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Issues */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="text-center text-stone-400 py-12">
            <AlertTriangle size={28} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">이슈가 없습니다.</p>
          </div>
        ) : (
          filtered.map(issue => {
            const st = ISSUE_STATUS_CONFIG[issue.status];
            const urg = URGENCY_LABELS[issue.urgency];
            const next = ISSUE_NEXT_STATUS[issue.status];
            const nextLabel = next ? ISSUE_STATUS_CONFIG[next]?.label : null;

            return (
              <div key={issue.id} className="bg-white border border-stone-200 p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 tracking-wider ${st.bg} ${st.color}`}>{st.label}</span>
                      <span className="text-[10px] text-stone-400 tracking-wider">{ISSUE_CATEGORY_LABELS[issue.category]}</span>
                      <span className={`text-[10px] tracking-wider ${urg.color}`}>{urg.label}</span>
                    </div>
                    <p className="text-stone-900 font-medium">{issue.title}</p>
                    <p className="text-stone-500 text-xs mt-1">{issue.propertyName} — {issue.reportedByName}</p>
                    {issue.description && <p className="text-stone-400 text-xs mt-2 leading-relaxed">{issue.description}</p>}
                    {issue.resolvedNote && (
                      <p className="text-green-600/80 text-xs mt-2">처리 내용: {issue.resolvedNote}</p>
                    )}
                  </div>
                  <p className="text-stone-300 text-[10px] shrink-0">
                    {format(parseISO(issue.createdAt), 'M/d HH:mm', { locale: ko })}
                  </p>
                </div>

                {/* Action area */}
                {next && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-2 border-t border-stone-100">
                    {(next === 'resolved') && (
                      <input
                        type="text"
                        value={resolveNote[issue.id] ?? ''}
                        onChange={e => setResolveNote(prev => ({ ...prev, [issue.id]: e.target.value }))}
                        placeholder="처리 내용 메모"
                        className="flex-1 bg-white border border-stone-200 px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15"
                      />
                    )}
                    <button
                      onClick={() => handleStatusChange(issue)}
                      disabled={updating === issue.id}
                      className={`px-4 py-2.5 text-[11px] uppercase tracking-widest font-semibold transition-colors flex items-center justify-center gap-1.5 active:scale-[0.98] shrink-0 ${
                        next === 'resolved'
                          ? 'bg-green-50 text-green-700 hover:bg-green-100'
                          : 'border border-stone-300 text-stone-700 hover:text-stone-900'
                      }`}
                    >
                      {updating === issue.id ? (
                        <div className="w-3 h-3 border border-stone-300 border-t-stone-700 rounded-full animate-spin" />
                      ) : (
                        <><ArrowRight size={12} /> {nextLabel}</>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
