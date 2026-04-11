'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, doc, getDoc, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { AlertTriangle, Plus, Send } from 'lucide-react';
import type { CleaningIssue, IssueCategory, IssueUrgency } from '@/lib/types';

const CATEGORIES: { value: IssueCategory; label: string }[] = [
  { value: 'damage', label: '파손' },
  { value: 'malfunction', label: '고장' },
  { value: 'missing_item', label: '분실/부족' },
  { value: 'hygiene', label: '위생 문제' },
  { value: 'other', label: '기타' },
];

const URGENCY: { value: IssueUrgency; label: string }[] = [
  { value: 'low', label: '낮음' },
  { value: 'normal', label: '보통' },
  { value: 'urgent', label: '긴급' },
];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open: { label: '접수', color: 'bg-amber-500/20 text-amber-400' },
  in_progress: { label: '처리중', color: 'bg-blue-500/20 text-blue-400' },
  resolved: { label: '해결', color: 'bg-green-500/20 text-green-400' },
  closed: { label: '종료', color: 'bg-white/10 text-white/40' },
};

export default function CleanerIssuesPage() {
  const { user, profile } = useAuth();
  const [issues, setIssues] = useState<(CleaningIssue & { propertyName: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [selectedProperty, setSelectedProperty] = useState('');
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [category, setCategory] = useState<IssueCategory>('other');
  const [urgency, setUrgency] = useState<IssueUrgency>('normal');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!user || !profile) return;
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile]);

  const loadData = async () => {
    if (!user || !profile) return;
    try {
      let propertyIds: string[] = [];
      if (profile.role === 'super_admin') {
        const snap = await getDocs(collection(db, 'properties'));
        propertyIds = snap.docs.map(d => d.id);
      } else {
        propertyIds = profile.propertyIds;
      }

      const propNames: Record<string, string> = {};
      const propList: { id: string; name: string }[] = [];
      await Promise.all(propertyIds.map(async pid => {
        const snap = await getDoc(doc(db, 'properties', pid));
        if (snap.exists()) {
          propNames[pid] = snap.data().name;
          propList.push({ id: pid, name: snap.data().name });
        }
      }));
      setProperties(propList);
      if (propList.length > 0 && !selectedProperty) setSelectedProperty(propList[0].id);

      // Fetch issues reported by me
      const issuesSnap = await getDocs(query(
        collection(db, 'cleaning_issues'),
        where('reportedBy', '==', user.uid)
      ));

      const result = issuesSnap.docs.map(d => {
        const data = d.data();
        return {
          ...data,
          id: d.id,
          propertyName: propNames[data.propertyId] ?? '알 수 없는 숙소',
        } as CleaningIssue & { propertyName: string };
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      setIssues(result);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!user || !profile || !title.trim() || !selectedProperty) return;
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'cleaning_issues'), {
        cleaningId: '',
        propertyId: selectedProperty,
        reportedBy: user.uid,
        reportedByName: profile.displayName || user.email || 'unknown',
        category,
        title: title.trim(),
        description: description.trim(),
        urgency,
        status: 'open',
        createdAt: new Date().toISOString(),
      });
      setTitle('');
      setDescription('');
      setCategory('other');
      setUrgency('normal');
      setShowForm(false);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('이슈 등록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="border-b border-white/10 pb-6 mt-4 flex items-end justify-between">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-white/50 mb-2">이슈 관리</p>
          <h1 className="text-2xl font-light tracking-tight text-white">이슈 등록</h1>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="border border-white/20 text-white px-4 py-2.5 text-[10px] uppercase tracking-widest font-semibold hover:bg-white/5 transition-colors flex items-center gap-1.5"
        >
          <Plus size={14} /> 새 이슈
        </button>
      </header>

      {/* New Issue Form */}
      {showForm && (
        <div className="border border-white/10 bg-[#111] p-5 space-y-4">
          <p className="text-[10px] uppercase tracking-widest text-white/50 font-semibold">새 이슈 등록</p>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">숙소</label>
            <select
              value={selectedProperty}
              onChange={e => setSelectedProperty(e.target.value)}
              className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
            >
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">카테고리</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as IssueCategory)}
                className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
              >
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">긴급도</label>
              <select
                value={urgency}
                onChange={e => setUrgency(e.target.value as IssueUrgency)}
                className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
              >
                {URGENCY.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">제목</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="예: 거실 창문 균열"
              className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">상세 설명</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="상세 내용을 입력하세요"
              className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 resize-none"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || !title.trim()}
            className="w-full bg-white text-black py-3 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            ) : (
              <><Send size={14} /> 등록</>
            )}
          </button>
        </div>
      )}

      {/* Issues List */}
      <section className="space-y-3">
        {issues.length === 0 ? (
          <div className="flex flex-col items-center text-white/40 py-12">
            <AlertTriangle size={28} className="mb-3 opacity-50" />
            <p className="text-sm">등록된 이슈가 없습니다.</p>
          </div>
        ) : (
          issues.map(issue => {
            const st = STATUS_LABELS[issue.status] ?? STATUS_LABELS.open;
            return (
              <div key={issue.id} className="border border-white/10 bg-[#111] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 tracking-wider ${st.color}`}>{st.label}</span>
                      <span className="text-[10px] text-white/30 tracking-wider">
                        {CATEGORIES.find(c => c.value === issue.category)?.label}
                      </span>
                      {issue.urgency === 'urgent' && (
                        <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 tracking-wider">긴급</span>
                      )}
                    </div>
                    <p className="text-white font-medium text-sm">{issue.title}</p>
                    <p className="text-white/40 text-xs mt-1">{issue.propertyName}</p>
                    {issue.description && (
                      <p className="text-white/30 text-xs mt-2 leading-relaxed">{issue.description}</p>
                    )}
                    {issue.resolvedNote && (
                      <p className="text-green-400/60 text-xs mt-2">처리 내용: {issue.resolvedNote}</p>
                    )}
                  </div>
                  <p className="text-white/20 text-[10px] shrink-0">
                    {format(parseISO(issue.createdAt), 'M/d', { locale: ko })}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
