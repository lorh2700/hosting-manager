'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { format, parseISO, addDays, startOfWeek, isToday } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarDays, Hand, CheckCircle2, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

interface OpenCleaning {
  id: string;
  propertyId: string;
  propertyName: string;
  date: string;
  supplies?: string;
  notes?: string;
  isOpen: boolean;
  cleanerId?: string;
  status: 'pending' | 'done';
}

interface MyApplication {
  id: string;
  cleaningId: string;
  propertyName: string;
  date: string;
  note?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectedReason?: string;
  createdAt: string;
}

export default function CleanerSchedulePage() {
  const { user, profile } = useAuth();
  const [openCleanings, setOpenCleanings] = useState<OpenCleaning[]>([]);
  const [myApplications, setMyApplications] = useState<MyApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [applyNote, setApplyNote] = useState('');
  const [showApplyForm, setShowApplyForm] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    if (!user || !profile) return;
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile, weekOffset]);

  const loadData = async () => {
    if (!user || !profile) return;
    setLoading(true);
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

      // Fetch open cleanings
      const cleaningsRes = await fetch(`/api/cleanings?propertyIds=${propertyIds.join(',')}&isOpen=true`);
      const cleaningsData = await cleaningsRes.json();

      const opens: OpenCleaning[] = cleaningsData.map((c: Record<string, unknown>) => ({
        id: c.id as string,
        propertyId: c.propertyId as string,
        propertyName: propNames[c.propertyId as string] ?? '알 수 없는 숙소',
        date: c.date as string,
        supplies: c.supplies as string | undefined,
        notes: c.notes as string | undefined,
        isOpen: c.isOpen as boolean,
        cleanerId: c.cleanerId as string | undefined,
        status: c.status as 'pending' | 'done',
      })).sort((a: OpenCleaning, b: OpenCleaning) => a.date.localeCompare(b.date));

      setOpenCleanings(opens);

      // Fetch my applications
      const appsRes = await fetch(`/api/cleaning-applications?propertyIds=${propertyIds.join(',')}`);
      const appsData = await appsRes.json();

      // Filter to only my applications
      const myApps = appsData.filter((a: Record<string, unknown>) => a.applicantId === user.id);

      const apps: MyApplication[] = myApps.map((a: Record<string, unknown>) => {
        // Find cleaning info from already fetched cleanings
        const cleaning = cleaningsData.find((c: Record<string, unknown>) => c.id === a.cleaningId);
        return {
          id: a.id as string,
          cleaningId: a.cleaningId as string,
          propertyName: cleaning ? propNames[cleaning.propertyId as string] ?? '알 수 없는 숙소' : '',
          date: cleaning ? (cleaning.date as string) : '',
          note: a.note as string | undefined,
          status: a.status as 'pending' | 'approved' | 'rejected',
          rejectedReason: a.rejectedReason as string | undefined,
          createdAt: a.createdAt as string,
        };
      }).sort((a: MyApplication, b: MyApplication) => b.createdAt.localeCompare(a.createdAt));

      setMyApplications(apps);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (cleaning: OpenCleaning) => {
    if (!user || !profile) return;
    setApplying(cleaning.id);
    try {
      const res = await fetch('/api/cleaning-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cleaningId: cleaning.id,
          propertyId: cleaning.propertyId,
          applicantId: user.id,
          applicantName: profile.displayName || user.email || 'unknown',
          note: applyNote.trim() || null,
          status: 'pending',
        }),
      });
      if (!res.ok) throw new Error('Failed to apply');

      setShowApplyForm(null);
      setApplyNote('');
      alert('신청이 완료되었습니다. 매니저 승인을 기다려주세요.');
      await loadData();
    } catch (err) {
      console.error(err);
      alert('신청에 실패했습니다.');
    } finally {
      setApplying(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  // Week navigation
  const weekStart = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 tracking-wider">대기</span>;
      case 'approved': return <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 tracking-wider">승인</span>;
      case 'rejected': return <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 tracking-wider">거절</span>;
      default: return null;
    }
  };

  // Check if user already applied for a cleaning
  const hasApplied = (cleaningId: string) =>
    myApplications.some(a => a.cleaningId === cleaningId && a.status !== 'rejected');

  return (
    <div className="space-y-10">
      <header className="border-b border-white/10 pb-6 mt-4">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-2">일정 관리</p>
        <h1 className="text-2xl font-light tracking-tight text-white">청소 일정 신청</h1>
      </header>

      {/* Week Navigation */}
      <div className="flex items-center justify-between">
        <button onClick={() => setWeekOffset(w => w - 1)} className="text-white/40 hover:text-white p-2">
          <ChevronLeft size={20} />
        </button>
        <div className="flex gap-1">
          {weekDays.map(d => (
            <div key={d.toISOString()} className={`text-center px-2 py-1 text-xs ${
              isToday(d) ? 'text-white bg-white/10' : 'text-white/40'
            }`}>
              <div className="text-[9px] uppercase">{format(d, 'EEE', { locale: ko })}</div>
              <div>{format(d, 'd')}</div>
            </div>
          ))}
        </div>
        <button onClick={() => setWeekOffset(w => w + 1)} className="text-white/40 hover:text-white p-2">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Open Cleanings */}
      <section className="space-y-3">
        <h2 className="text-[10px] uppercase tracking-widest text-white/40">신청 가능한 일정 ({openCleanings.length})</h2>
        {openCleanings.length === 0 ? (
          <div className="flex flex-col items-center text-white/40 py-12">
            <CalendarDays size={28} className="mb-3 opacity-50" />
            <p className="text-sm">현재 신청 가능한 일정이 없습니다.</p>
          </div>
        ) : (
          openCleanings.map(c => (
            <div key={c.id} className="border border-white/10 bg-[#111] p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-white font-medium text-sm">{c.propertyName}</p>
                  <p className="text-white/40 text-xs mt-1">
                    {format(parseISO(c.date), 'M월 d일 (EEE)', { locale: ko })}
                  </p>
                  {c.notes && <p className="text-white/30 text-xs mt-1">{c.notes}</p>}
                </div>
                <div>
                  {hasApplied(c.id) ? (
                    <span className="text-[10px] text-green-400 tracking-wider flex items-center gap-1">
                      <CheckCircle2 size={12} /> 신청완료
                    </span>
                  ) : (
                    <button
                      onClick={() => setShowApplyForm(showApplyForm === c.id ? null : c.id)}
                      className="border border-white/20 text-white px-3 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-white/5 transition-colors flex items-center gap-1.5"
                    >
                      <Hand size={12} /> 신청
                    </button>
                  )}
                </div>
              </div>

              {showApplyForm === c.id && (
                <div className="mt-4 pt-4 border-t border-white/5 space-y-3">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">메모 (선택)</label>
                    <input
                      type="text"
                      value={applyNote}
                      onChange={e => setApplyNote(e.target.value)}
                      placeholder="예: 오전에 가능합니다"
                      className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
                    />
                  </div>
                  <button
                    onClick={() => handleApply(c)}
                    disabled={applying === c.id}
                    className="w-full bg-white text-black py-3 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {applying === c.id ? (
                      <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    ) : (
                      '신청하기'
                    )}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </section>

      {/* My Applications */}
      {myApplications.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[10px] uppercase tracking-widest text-white/40">내 신청 내역 ({myApplications.length})</h2>
          {myApplications.map(app => (
            <div key={app.id} className={`border p-4 ${
              app.status === 'approved' ? 'border-green-500/20 bg-green-500/5' :
              app.status === 'rejected' ? 'border-red-500/20 bg-red-500/5' :
              'border-white/10 bg-[#111]'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-medium">{app.propertyName}</p>
                  <p className="text-white/40 text-xs mt-0.5">
                    {app.date && format(parseISO(app.date), 'M월 d일 (EEE)', { locale: ko })}
                  </p>
                  {app.note && <p className="text-white/30 text-xs mt-1">메모: {app.note}</p>}
                  {app.rejectedReason && <p className="text-red-400/60 text-xs mt-1">사유: {app.rejectedReason}</p>}
                </div>
                {getStatusBadge(app.status)}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
