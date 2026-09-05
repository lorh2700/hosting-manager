'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
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

      // Resolve logged-in user's Cleaner record
      const meRes = await fetch('/api/cleaners/me');
      const meData = meRes.ok ? await meRes.json() : { cleaner: null };
      const myCleanerId: string | null = meData?.cleaner?.id ?? null;

      // Fetch cleanings
      const cleaningsRes = await fetch(`/api/cleanings?propertyIds=${propertyIds.join(',')}`);
      const cleaningsData = await cleaningsRes.json();

      // Filter by cleanerId if not super_admin
      const filteredCleanings = profile.role === 'admin'
        ? cleaningsData
        : myCleanerId
          ? cleaningsData.filter((c: { cleanerId?: string }) => c.cleanerId === myCleanerId)
          : [];

      const pastItems: PastCleaning[] = filteredCleanings
        .map((c: Record<string, unknown>) => ({
          id: c.id as string,
          propertyName: propNames[c.propertyId as string] ?? '알 수 없는 숙소',
          date: c.date as string,
          status: (c.status as string) ?? 'pending',
          completionNote: c.completionNote as string | undefined,
          completedAt: c.completedAt as string | undefined,
          hasIssue: c.hasIssue as boolean | undefined,
          supplies: c.supplies as string | undefined,
        }))
        .filter((c: PastCleaning) => isPast(parseISO(c.date)) && !isToday(parseISO(c.date)))
        .sort((a: PastCleaning, b: PastCleaning) => b.date.localeCompare(a.date));

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
      <header className="border-b border-stone-200 pb-6 mt-4">
        <p className="text-[10px] tracking-[0.3em] text-stone-500 mb-2">청소 기록</p>
        <h1 className="text-2xl font-light tracking-tight text-stone-900">지난 기록</h1>
      </header>

      {history.length === 0 ? (
        <div className="flex flex-col items-center text-stone-400 py-16">
          <History size={32} className="mb-4 opacity-50" />
          <p className="text-sm">지난 청소 기록이 없습니다.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([month, items]) => (
          <section key={month} className="space-y-3">
            <h2 className="text-[10px] uppercase tracking-widest text-stone-400">{month} ({items.length}건)</h2>
            {items.map(c => (
              <div key={c.id} className={`border p-4 ${
                c.status === 'done' ? 'border-stone-100 bg-stone-50' : 'border-amber-500/20 bg-amber-500/5'
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
                    <p className="text-stone-900 text-sm">{c.propertyName}</p>
                    {c.completionNote && <p className="text-stone-300 text-xs mt-1">{c.completionNote}</p>}
                  </div>
                  <p className="text-stone-300 text-xs">{format(parseISO(c.date), 'M/d (EEE)', { locale: ko })}</p>
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
