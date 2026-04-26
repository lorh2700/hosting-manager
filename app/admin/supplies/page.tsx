'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Package, Check, X } from 'lucide-react';
import type { SupplyRequest } from '@/lib/types';
import { SUPPLY_STATUS_CONFIG } from '@/lib/constants';
import { fetchPropertyNames, enrichWithPropertyName, apiPut } from '@/lib/api-client';

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
      const [propNames, reqData] = await Promise.all([
        fetchPropertyNames(),
        fetch('/api/supply-requests').then(r => r.json()) as Promise<SupplyRequest[]>,
      ]);

      const result = enrichWithPropertyName(reqData, propNames)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
      await apiPut('/api/supply-requests', {
        id: reqId,
        status: action,
        statusNote: statusNotes[reqId] || null,
        processedBy: user.id,
        processedAt: new Date().toISOString(),
      });
      setRequests(prev => prev.map(r =>
        r.id === reqId ? { ...r, status: action, processedBy: user.id, processedAt: new Date().toISOString(), statusNote: statusNotes[reqId] || undefined } : r
      ));
    } catch (err) {
      console.error(err);
      alert('처리에 실패했습니다.');
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 border-t-2 border-[var(--brand)] rounded-full animate-spin" /></div>;
  }

  const filtered = filter === 'pending'
    ? requests.filter(r => r.status === 'pending' || r.status === 'approved')
    : requests;

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="max-w-3xl mx-auto space-y-6 sm:space-y-8">
      <header className="border-b border-stone-200 pb-5 sm:pb-6">
        <p className="text-[10px] tracking-[0.3em] text-stone-500 mb-3">관리</p>
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-stone-900">비품 요청 관리</h1>
        {pendingCount > 0 && (
          <p className="text-amber-600 text-sm mt-2">{pendingCount}건의 새 요청</p>
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
            className={`px-4 py-2.5 text-[11px] uppercase tracking-widest font-semibold transition-colors ${
              filter === f.key ? 'bg-[var(--brand)] text-white' : 'border border-stone-200 text-stone-500 hover:text-stone-900'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="text-center text-stone-400 py-12">
            <Package size={28} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">비품 요청이 없습니다.</p>
          </div>
        ) : (
          filtered.map(req => {
            const st = SUPPLY_STATUS_CONFIG[req.status];
            return (
              <div key={req.id} className="bg-white border border-stone-200 p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] px-1.5 py-0.5 tracking-wider ${st.bg} ${st.color}`}>{st.label}</span>
                      {req.urgency === 'urgent' && (
                        <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 tracking-wider">긴급</span>
                      )}
                    </div>
                    <p className="text-stone-900 font-medium text-sm">{req.propertyName}</p>
                    <p className="text-stone-500 text-xs mt-0.5">요청자: {req.requestedByName}</p>
                  </div>
                  <p className="text-stone-300 text-[10px] shrink-0">
                    {format(parseISO(req.createdAt), 'M/d HH:mm', { locale: ko })}
                  </p>
                </div>

                {/* Items */}
                <div className="bg-stone-100 p-3 space-y-1">
                  {req.items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-stone-700">{item.name}</span>
                      <span className="text-stone-500">{item.quantity}개</span>
                    </div>
                  ))}
                </div>

                {req.statusNote && (
                  <p className="text-stone-500 text-xs">메모: {req.statusNote}</p>
                )}

                {/* Actions */}
                {req.status === 'pending' && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-2 border-t border-stone-100">
                    <input
                      type="text"
                      value={statusNotes[req.id] ?? ''}
                      onChange={e => setStatusNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                      placeholder="메모 (선택)"
                      className="flex-1 bg-white border border-stone-200 px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAction(req.id, 'approved')}
                        disabled={updating === req.id}
                        className="flex-1 sm:flex-initial bg-green-50 text-green-700 px-4 py-2.5 text-[11px] uppercase tracking-widest font-semibold hover:bg-green-100 active:scale-[0.98] transition-all flex items-center justify-center gap-1"
                      >
                        <Check size={13} /> 승인
                      </button>
                      <button
                        onClick={() => handleAction(req.id, 'rejected')}
                        disabled={updating === req.id}
                        className="flex-1 sm:flex-initial bg-red-50 text-red-600 px-4 py-2.5 text-[11px] uppercase tracking-widest font-semibold hover:bg-red-100 active:scale-[0.98] transition-all flex items-center justify-center gap-1"
                      >
                        <X size={13} /> 거절
                      </button>
                    </div>
                  </div>
                )}
                {req.status === 'approved' && (
                  <div className="pt-2 border-t border-stone-100">
                    <button
                      onClick={() => handleAction(req.id, 'completed')}
                      disabled={updating === req.id}
                      className="w-full border border-green-300 text-green-700 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-green-50 transition-colors"
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
