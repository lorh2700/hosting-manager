'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, doc, getDoc, updateDoc, addDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarDays, Check, X, Plus, Users } from 'lucide-react';
import type { CleaningApplication, Cleaning } from '@/lib/types';

interface EnrichedApplication extends CleaningApplication {
  propertyName: string;
  cleaningDate: string;
}

interface OpenCleaning extends Cleaning {
  propertyName: string;
  applicationCount: number;
}

export default function AdminCleaningRequestsPage() {
  const { user, profile } = useAuth();
  const [applications, setApplications] = useState<EnrichedApplication[]>([]);
  const [openCleanings, setOpenCleanings] = useState<OpenCleaning[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<'requests' | 'open'>('requests');

  // Create open cleaning form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [newCleaningProp, setNewCleaningProp] = useState('');
  const [newCleaningDate, setNewCleaningDate] = useState('');
  const [newCleaningNotes, setNewCleaningNotes] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user || !profile) return;
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile]);

  const loadData = async () => {
    if (!user || !profile) return;
    try {
      const propSnap = await getDocs(collection(db, 'properties'));
      const propNames: Record<string, string> = {};
      const propList: { id: string; name: string }[] = [];
      propSnap.docs.forEach(d => {
        propNames[d.id] = d.data().name;
        propList.push({ id: d.id, name: d.data().name });
      });
      setProperties(propList);
      if (propList.length > 0 && !newCleaningProp) setNewCleaningProp(propList[0].id);

      // Fetch all applications
      const appsSnap = await getDocs(collection(db, 'cleaning_applications'));
      const apps: EnrichedApplication[] = await Promise.all(appsSnap.docs.map(async d => {
        const data = d.data();
        let cleaningDate = '';
        let propertyName = propNames[data.propertyId] ?? '';
        try {
          const cleaningDoc = await getDoc(doc(db, 'cleanings', data.cleaningId));
          if (cleaningDoc.exists()) {
            const cd = cleaningDoc.data();
            cleaningDate = cd.date;
            if (!propertyName) propertyName = propNames[cd.propertyId] ?? '알 수 없는 숙소';
          }
        } catch { /* ignore */ }
        return {
          ...data,
          id: d.id,
          propertyName,
          cleaningDate,
        } as EnrichedApplication;
      }));

      setApplications(apps.sort((a, b) => {
        const statusOrder = { pending: 0, approved: 1, rejected: 2 };
        if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
        return b.createdAt.localeCompare(a.createdAt);
      }));

      // Fetch open cleanings
      const cleaningsSnap = await getDocs(query(
        collection(db, 'cleanings'),
        where('isOpen', '==', true)
      ));

      // Count applications per cleaning
      const appCounts: Record<string, number> = {};
      apps.filter(a => a.status === 'pending').forEach(a => {
        appCounts[a.cleaningId] = (appCounts[a.cleaningId] ?? 0) + 1;
      });

      const opens: OpenCleaning[] = cleaningsSnap.docs.map(d => {
        const data = d.data();
        return {
          ...data,
          id: d.id,
          propertyName: propNames[data.propertyId] ?? '알 수 없는 숙소',
          applicationCount: appCounts[d.id] ?? 0,
        } as OpenCleaning;
      }).sort((a, b) => a.date.localeCompare(b.date));

      setOpenCleanings(opens);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (app: EnrichedApplication) => {
    if (!user) return;
    setUpdating(app.id);
    try {
      const batch = writeBatch(db);

      // Approve this application
      batch.update(doc(db, 'cleaning_applications', app.id), {
        status: 'approved',
        processedBy: user.uid,
        processedAt: new Date().toISOString(),
      });

      // Assign cleaner to the cleaning
      batch.update(doc(db, 'cleanings', app.cleaningId), {
        cleanerId: app.applicantId,
        isOpen: false,
        assignmentType: 'applied',
        updatedAt: new Date().toISOString(),
      });

      // Reject other pending applications for the same cleaning
      const otherApps = applications.filter(
        a => a.cleaningId === app.cleaningId && a.id !== app.id && a.status === 'pending'
      );
      for (const other of otherApps) {
        batch.update(doc(db, 'cleaning_applications', other.id), {
          status: 'rejected',
          rejectedReason: '다른 담당자가 배정되었습니다',
          processedBy: user.uid,
          processedAt: new Date().toISOString(),
        });
      }

      await batch.commit();
      await loadData();
    } catch (err) {
      console.error(err);
      alert('승인 처리에 실패했습니다.');
    } finally {
      setUpdating(null);
    }
  };

  const handleReject = async (app: EnrichedApplication) => {
    if (!user) return;
    setUpdating(app.id);
    try {
      await updateDoc(doc(db, 'cleaning_applications', app.id), {
        status: 'rejected',
        rejectedReason: rejectReasons[app.id] || null,
        processedBy: user.uid,
        processedAt: new Date().toISOString(),
      });
      await loadData();
    } catch (err) {
      console.error(err);
      alert('거절 처리에 실패했습니다.');
    } finally {
      setUpdating(null);
    }
  };

  const handleCreateOpenCleaning = async () => {
    if (!newCleaningProp || !newCleaningDate) return;
    setCreating(true);
    try {
      await addDoc(collection(db, 'cleanings'), {
        propertyId: newCleaningProp,
        date: newCleaningDate,
        cleanerId: null,
        status: 'pending',
        isOpen: true,
        notes: newCleaningNotes.trim() || null,
        createdAt: new Date().toISOString(),
      });
      setNewCleaningDate('');
      setNewCleaningNotes('');
      setShowCreateForm(false);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('일정 생성에 실패했습니다.');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 border-t-2 border-white rounded-full animate-spin" /></div>;
  }

  const pendingApps = applications.filter(a => a.status === 'pending');

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header className="border-b border-white/10 pb-6">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-3">관리</p>
        <h1 className="text-3xl font-light tracking-tight text-white">청소 일정 신청 관리</h1>
        {pendingApps.length > 0 && (
          <p className="text-amber-400 text-sm mt-2">{pendingApps.length}건의 대기 중인 신청</p>
        )}
      </header>

      {/* Tabs */}
      <div className="flex gap-2">
        {[
          { key: 'requests', label: `신청 내역 (${pendingApps.length})` },
          { key: 'open', label: `오픈 일정 (${openCleanings.length})` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`px-4 py-2 text-[10px] uppercase tracking-widest font-semibold transition-colors ${
              tab === t.key ? 'bg-white text-black' : 'border border-white/10 text-white/50 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'requests' ? (
        /* Applications List */
        <div className="space-y-4">
          {applications.length === 0 ? (
            <div className="text-center text-white/40 py-12">
              <Users size={28} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm">청소 신청 내역이 없습니다.</p>
            </div>
          ) : (
            applications.map(app => {
              const isPending = app.status === 'pending';
              const statusColor = app.status === 'approved' ? 'text-green-400 bg-green-500/20' :
                app.status === 'rejected' ? 'text-red-400 bg-red-500/20' :
                'text-amber-400 bg-amber-500/20';
              const statusLabel = app.status === 'approved' ? '승인' :
                app.status === 'rejected' ? '거절' : '대기';

              return (
                <div key={app.id} className="bg-[#111] border border-white/10 p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-[10px] px-1.5 py-0.5 tracking-wider ${statusColor}`}>{statusLabel}</span>
                      </div>
                      <p className="text-white font-medium text-sm">{app.propertyName}</p>
                      <p className="text-white/40 text-xs mt-0.5">
                        날짜: {app.cleaningDate && format(parseISO(app.cleaningDate), 'M월 d일 (EEE)', { locale: ko })}
                      </p>
                      <p className="text-white/40 text-xs mt-0.5">신청자: {app.applicantName}</p>
                      {app.note && <p className="text-white/30 text-xs mt-1">메모: {app.note}</p>}
                      {app.rejectedReason && <p className="text-red-400/60 text-xs mt-1">거절 사유: {app.rejectedReason}</p>}
                    </div>
                    <p className="text-white/20 text-[10px] shrink-0">
                      {format(parseISO(app.createdAt), 'M/d HH:mm', { locale: ko })}
                    </p>
                  </div>

                  {isPending && (
                    <div className="flex items-center gap-3 pt-2 border-t border-white/5">
                      <input
                        type="text"
                        value={rejectReasons[app.id] ?? ''}
                        onChange={e => setRejectReasons(prev => ({ ...prev, [app.id]: e.target.value }))}
                        placeholder="거절 사유 (선택)"
                        className="flex-1 bg-black/50 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-white/30"
                      />
                      <button
                        onClick={() => handleApprove(app)}
                        disabled={updating === app.id}
                        className="bg-green-500/20 text-green-400 px-4 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-green-500/30 transition-colors flex items-center gap-1"
                      >
                        <Check size={12} /> 승인
                      </button>
                      <button
                        onClick={() => handleReject(app)}
                        disabled={updating === app.id}
                        className="bg-red-500/20 text-red-400 px-4 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-red-500/30 transition-colors flex items-center gap-1"
                      >
                        <X size={12} /> 거절
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Open Cleanings Tab */
        <div className="space-y-4">
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="w-full border border-dashed border-white/20 text-white/50 py-4 text-[10px] uppercase tracking-widest font-semibold hover:bg-white/5 hover:text-white transition-colors flex items-center justify-center gap-2"
          >
            <Plus size={14} /> 빈 일정 생성 (신청 받기)
          </button>

          {showCreateForm && (
            <div className="bg-[#111] border border-white/10 p-5 space-y-4">
              <p className="text-[10px] uppercase tracking-widest text-white/50 font-semibold">새 오픈 일정</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">숙소</label>
                  <select
                    value={newCleaningProp}
                    onChange={e => setNewCleaningProp(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
                  >
                    {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">날짜</label>
                  <input
                    type="date"
                    value={newCleaningDate}
                    onChange={e => setNewCleaningDate(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">메모 (선택)</label>
                <input
                  type="text"
                  value={newCleaningNotes}
                  onChange={e => setNewCleaningNotes(e.target.value)}
                  placeholder="예: 이불 커버 교체 필요"
                  className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
                />
              </div>
              <button
                onClick={handleCreateOpenCleaning}
                disabled={creating || !newCleaningDate}
                className="w-full bg-white text-black py-3 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50"
              >
                {creating ? '생성 중...' : '일정 생성'}
              </button>
            </div>
          )}

          {openCleanings.length === 0 ? (
            <div className="text-center text-white/40 py-12">
              <CalendarDays size={28} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm">오픈된 청소 일정이 없습니다.</p>
            </div>
          ) : (
            openCleanings.map(c => (
              <div key={c.id} className="bg-[#111] border border-white/10 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-white font-medium text-sm">{c.propertyName}</p>
                    <p className="text-white/40 text-xs mt-0.5">
                      {format(parseISO(c.date), 'M월 d일 (EEE)', { locale: ko })}
                    </p>
                    {c.notes && <p className="text-white/30 text-xs mt-1">{c.notes}</p>}
                  </div>
                  <div className="text-right">
                    {c.applicationCount > 0 ? (
                      <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-1 tracking-wider">
                        {c.applicationCount}명 신청
                      </span>
                    ) : (
                      <span className="text-[10px] text-white/20 tracking-wider">신청 없음</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
