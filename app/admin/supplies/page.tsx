'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Package, Check, X } from 'lucide-react';
import type { SupplyRequest } from '@/lib/types';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '대기', color: 'text-amber-400', bg: 'bg-amber-500/20' },
  approved: { label: '승인', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  rejected: { label: '거절', color: 'text-red-400', bg: 'bg-red-500/20' },
  completed: { label: '완료', color: 'text-green-400', bg: 'bg-green-500/20' },
};

export default function AdminSuppliesPage() {
  const { user, profile } = useAuth();
  const [requests, setRequests] = useState<(SupplyRequest & { propertyName: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [updating, setUpdating] = useState<string | null>(null);
  const [statusNotes, setStatusNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user || !profile) return;
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile]);

  const loadData = async () => {
    try {
      const propSnap = await getDocs(collection(db, 'properties'));
      const propNames: Record<string, string> = {};
      propSnap.docs.forEach(d => { propNames[d.id] = d.data().name; });

      const reqSnap = await getDocs(collection(db, 'supply_requests'));
      const result = reqSnap.docs.map(d => {
        const data = d.data();
        return {
          ...data,
          id: d.id,
          propertyName: propNames[data.propertyId] ?? '알 수 없는 숙소',
        } as SupplyRequest & { propertyName: string };
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      setRequests(result);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (reqId: string, action: 'approved' | 'rejected' | 'completed') => {
    if (!user) return;
    setUpdating(reqId);
    try {
      await updateDoc(doc(db, 'supply_requests', reqId), {
        status: action,
        statusNote: statusNotes[reqId] || null,
        processedBy: user.uid,
        processedAt: new Date().toISOString(),
      });
      setRequests(prev => prev.map(r =>
        r.id === reqId ? { ...r, status: action, processedBy: user.uid, processedAt: new Date().toISOString(), statusNote: statusNotes[reqId] || undefined } : r
      ));
    } catch (err) {
      console.error(err);
      alert('처리에 실패했습니다.');
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 border-t-2 border-white rounded-full animate-spin" /></div>;
  }

  const filtered = filter === 'pending'
    ? requests.filter(r => r.status === 'pending' || r.status === 'approved')
    : requests;

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header className="border-b border-white/10 pb-6">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-3">관리</p>
        <h1 className="text-3xl font-light tracking-tight text-white">비품 요청 관리</h1>
        {pendingCount > 0 && (
          <p className="text-amber-400 text-sm mt-2">{pendingCount}건의 새 요청</p>
        )}
      </header>

      <div className="flex gap-2">
        {[
          { key: 'pending', label: '처리 필요' },
          { key: 'all', label: '전체' },
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

      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="text-center text-white/40 py-12">
            <Package size={28} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">비품 요청이 없습니다.</p>
          </div>
        ) : (
          filtered.map(req => {
            const st = STATUS_CONFIG[req.status];
            return (
              <div key={req.id} className="bg-[#111] border border-white/10 p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] px-1.5 py-0.5 tracking-wider ${st.bg} ${st.color}`}>{st.label}</span>
                      {req.urgency === 'urgent' && (
                        <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 tracking-wider">긴급</span>
                      )}
                    </div>
                    <p className="text-white font-medium text-sm">{req.propertyName}</p>
                    <p className="text-white/40 text-xs mt-0.5">요청자: {req.requestedByName}</p>
                  </div>
                  <p className="text-white/20 text-[10px] shrink-0">
                    {format(parseISO(req.createdAt), 'M/d HH:mm', { locale: ko })}
                  </p>
                </div>

                {/* Items */}
                <div className="bg-black/30 p-3 space-y-1">
                  {req.items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-white/70">{item.name}</span>
                      <span className="text-white/40">{item.quantity}개</span>
                    </div>
                  ))}
                </div>

                {req.statusNote && (
                  <p className="text-white/40 text-xs">메모: {req.statusNote}</p>
                )}

                {/* Actions */}
                {req.status === 'pending' && (
                  <div className="flex items-center gap-3 pt-2 border-t border-white/5">
                    <input
                      type="text"
                      value={statusNotes[req.id] ?? ''}
                      onChange={e => setStatusNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                      placeholder="메모 (선택)"
                      className="flex-1 bg-black/50 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-white/30"
                    />
                    <button
                      onClick={() => handleAction(req.id, 'approved')}
                      disabled={updating === req.id}
                      className="bg-green-500/20 text-green-400 px-4 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-green-500/30 transition-colors flex items-center gap-1"
                    >
                      <Check size={12} /> 승인
                    </button>
                    <button
                      onClick={() => handleAction(req.id, 'rejected')}
                      disabled={updating === req.id}
                      className="bg-red-500/20 text-red-400 px-4 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-red-500/30 transition-colors flex items-center gap-1"
                    >
                      <X size={12} /> 거절
                    </button>
                  </div>
                )}
                {req.status === 'approved' && (
                  <div className="pt-2 border-t border-white/5">
                    <button
                      onClick={() => handleAction(req.id, 'completed')}
                      disabled={updating === req.id}
                      className="w-full border border-green-500/30 text-green-400 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-green-500/10 transition-colors"
                    >
                      {updating === req.id ? '처리 중...' : '비품 지급 완료'}
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
