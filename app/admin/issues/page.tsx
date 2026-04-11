'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, Clock, ArrowRight } from 'lucide-react';
import type { CleaningIssue, IssueStatus } from '@/lib/types';

const CATEGORY_LABELS: Record<string, string> = {
  damage: '파손',
  malfunction: '고장',
  missing_item: '분실/부족',
  hygiene: '위생',
  other: '기타',
};

const URGENCY_LABELS: Record<string, { label: string; color: string }> = {
  low: { label: '낮음', color: 'text-white/40' },
  normal: { label: '보통', color: 'text-amber-400' },
  urgent: { label: '긴급', color: 'text-red-400' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: '접수', color: 'text-amber-400', bg: 'bg-amber-500/20' },
  in_progress: { label: '처리중', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  resolved: { label: '해결', color: 'text-green-400', bg: 'bg-green-500/20' },
  closed: { label: '종료', color: 'text-white/40', bg: 'bg-white/10' },
};

const NEXT_STATUS: Record<string, IssueStatus> = {
  open: 'in_progress',
  in_progress: 'resolved',
  resolved: 'closed',
};

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
      const [propsRes, issuesRes] = await Promise.all([
        fetch('/api/properties'),
        fetch('/api/cleaning-issues'),
      ]);
      if (!propsRes.ok || !issuesRes.ok) throw new Error('Failed to fetch data');

      const propsData: any[] = await propsRes.json();
      const propNames: Record<string, string> = {};
      propsData.forEach(d => { propNames[d.id] = d.name; });

      const issuesData: any[] = await issuesRes.json();
      const result = issuesData.map(d => ({
        ...d,
        propertyName: propNames[d.propertyId] ?? '알 수 없는 숙소',
      } as CleaningIssue & { propertyName: string })).sort((a, b) => {
        // urgent first, then by date
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
    const nextStatus = NEXT_STATUS[issue.status];
    if (!nextStatus) return;

    setUpdating(issue.id);
    try {
      const updateData: Record<string, unknown> = { id: issue.id, status: nextStatus };
      if (nextStatus === 'resolved') {
        updateData.resolvedBy = user.id;
        updateData.resolvedAt = new Date().toISOString();
        updateData.resolvedNote = resolveNote[issue.id] || null;
      }
      const res = await fetch('/api/cleaning-issues', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      if (!res.ok) throw new Error('Failed to update issue');
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
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 border-t-2 border-white rounded-full animate-spin" /></div>;
  }

  const filtered = issues.filter(i => {
    if (filter === 'open') return i.status === 'open' || i.status === 'in_progress';
    if (filter === 'resolved') return i.status === 'resolved' || i.status === 'closed';
    return true;
  });

  const openCount = issues.filter(i => i.status === 'open' || i.status === 'in_progress').length;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header className="border-b border-white/10 pb-6">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-3">관리</p>
        <h1 className="text-3xl font-light tracking-tight text-white">이슈 관리</h1>
        {openCount > 0 && (
          <p className="text-amber-400 text-sm mt-2">{openCount}건의 미해결 이슈</p>
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
            className={`px-4 py-2 text-[10px] uppercase tracking-widest font-semibold transition-colors ${
              filter === f.key ? 'bg-white text-black' : 'border border-white/10 text-white/50 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Issues */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="text-center text-white/40 py-12">
            <AlertTriangle size={28} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">이슈가 없습니다.</p>
          </div>
        ) : (
          filtered.map(issue => {
            const st = STATUS_CONFIG[issue.status];
            const urg = URGENCY_LABELS[issue.urgency];
            const next = NEXT_STATUS[issue.status];
            const nextLabel = next ? STATUS_CONFIG[next]?.label : null;

            return (
              <div key={issue.id} className="bg-[#111] border border-white/10 p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 tracking-wider ${st.bg} ${st.color}`}>{st.label}</span>
                      <span className="text-[10px] text-white/30 tracking-wider">{CATEGORY_LABELS[issue.category]}</span>
                      <span className={`text-[10px] tracking-wider ${urg.color}`}>{urg.label}</span>
                    </div>
                    <p className="text-white font-medium">{issue.title}</p>
                    <p className="text-white/40 text-xs mt-1">{issue.propertyName} — {issue.reportedByName}</p>
                    {issue.description && <p className="text-white/30 text-xs mt-2 leading-relaxed">{issue.description}</p>}
                    {issue.resolvedNote && (
                      <p className="text-green-400/60 text-xs mt-2">처리 내용: {issue.resolvedNote}</p>
                    )}
                  </div>
                  <p className="text-white/20 text-[10px] shrink-0">
                    {format(parseISO(issue.createdAt), 'M/d HH:mm', { locale: ko })}
                  </p>
                </div>

                {/* Action area */}
                {next && (
                  <div className="flex items-center gap-3 pt-2 border-t border-white/5">
                    {(next === 'resolved') && (
                      <input
                        type="text"
                        value={resolveNote[issue.id] ?? ''}
                        onChange={e => setResolveNote(prev => ({ ...prev, [issue.id]: e.target.value }))}
                        placeholder="처리 내용 메모"
                        className="flex-1 bg-black/50 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-white/30"
                      />
                    )}
                    <button
                      onClick={() => handleStatusChange(issue)}
                      disabled={updating === issue.id}
                      className={`px-4 py-2 text-[10px] uppercase tracking-widest font-semibold transition-colors flex items-center gap-1.5 ${
                        next === 'resolved'
                          ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                          : 'border border-white/20 text-white/60 hover:text-white'
                      }`}
                    >
                      {updating === issue.id ? (
                        <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
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
