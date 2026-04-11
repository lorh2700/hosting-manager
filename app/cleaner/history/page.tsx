'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { format, parseISO, isPast, isToday } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CheckCircle2, Clock, History } from 'lucide-react';

interface PastCleaning {
  id: string;
  propertyName: string;
  date: string;
  status: 'pending' | 'done';
  completionNote?: string;
  completedAt?: string;
  hasIssue?: boolean;
  supplies?: string;
}

export default function CleanerHistoryPage() {
  const { user, profile } = useAuth();
  const [history, setHistory] = useState<PastCleaning[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !profile) return;
    loadHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile]);

  const loadHistory = async () => {
    if (!user || !profile) return;
    try {
      let propertyIds: string[] = [];
      if (profile.role === 'super_admin') {
        const snap = await getDocs(collection(db, 'properties'));
        propertyIds = snap.docs.map(d => d.id);
      } else {
        propertyIds = profile.propertyIds;
      }
      if (propertyIds.length === 0) { setLoading(false); return; }

      const propNames: Record<string, string> = {};
      await Promise.all(propertyIds.map(async pid => {
        const snap = await getDoc(doc(db, 'properties', pid));
        if (snap.exists()) propNames[pid] = snap.data().name;
      }));

      const cleaningsQuery = profile.role === 'super_admin'
        ? query(collection(db, 'cleanings'), where('propertyId', 'in', propertyIds.slice(0, 10)))
        : query(collection(db, 'cleanings'), where('cleanerId', '==', user.uid), where('propertyId', 'in', propertyIds.slice(0, 10)));

      const snap = await getDocs(cleaningsQuery);

      const pastItems: PastCleaning[] = snap.docs
        .map(d => {
          const data = d.data();
          return {
            id: d.id,
            propertyName: propNames[data.propertyId] ?? '알 수 없는 숙소',
            date: data.date,
            status: data.status ?? 'pending',
            completionNote: data.completionNote,
            completedAt: data.completedAt,
            hasIssue: data.hasIssue,
            supplies: data.supplies,
          };
        })
        .filter(c => isPast(parseISO(c.date)) && !isToday(parseISO(c.date)))
        .sort((a, b) => b.date.localeCompare(a.date));

      setHistory(pastItems);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  // Group by month
  const grouped: Record<string, PastCleaning[]> = {};
  history.forEach(c => {
    const key = format(parseISO(c.date), 'yyyy년 M월', { locale: ko });
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  });

  return (
    <div className="space-y-8">
      <header className="border-b border-white/10 pb-6 mt-4">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-2">청소 기록</p>
        <h1 className="text-2xl font-light tracking-tight text-white">지난 기록</h1>
      </header>

      {history.length === 0 ? (
        <div className="flex flex-col items-center text-white/40 py-16">
          <History size={32} className="mb-4 opacity-50" />
          <p className="text-sm">지난 청소 기록이 없습니다.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([month, items]) => (
          <section key={month} className="space-y-3">
            <h2 className="text-[10px] uppercase tracking-widest text-white/40">{month} ({items.length}건)</h2>
            {items.map(c => (
              <div key={c.id} className={`border p-4 ${
                c.status === 'done' ? 'border-white/5 bg-[#0a0a0a]' : 'border-amber-500/20 bg-amber-500/5'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {c.status === 'done'
                        ? <CheckCircle2 size={12} className="text-green-400" />
                        : <Clock size={12} className="text-amber-400" />
                      }
                      <span className={`text-[10px] tracking-wider ${
                        c.status === 'done' ? 'text-green-400' : 'text-amber-400'
                      }`}>
                        {c.status === 'done' ? '완료' : '미완료'}
                      </span>
                      {c.hasIssue && (
                        <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5">이슈</span>
                      )}
                    </div>
                    <p className="text-white text-sm">{c.propertyName}</p>
                    {c.completionNote && <p className="text-white/30 text-xs mt-1">{c.completionNote}</p>}
                  </div>
                  <p className="text-white/30 text-xs">{format(parseISO(c.date), 'M/d (EEE)', { locale: ko })}</p>
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
