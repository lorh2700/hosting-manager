'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Package, Plus } from 'lucide-react';
import type { SupplyRequest } from '@/lib/types';
import { SUPPLY_STATUS_CONFIG } from '@/lib/constants';
import { SkeletonList } from '@/components/ui';
import SupplyRequestContent from '@/components/SupplyRequestContent';

export default function CleanerSuppliesPage() {
  const { user, profile } = useAuth();
  const [requests, setRequests] = useState<(SupplyRequest & { propertyName: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || !profile) return;
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile]);

  const loadData = async () => {
    if (!user || !profile) return;
    setError('');
    try {
      const propsRes = await fetch('/api/properties');
      if (!propsRes.ok) throw new Error('숙소를 불러오지 못했습니다.');
      const propsData = await propsRes.json();
      const propNames: Record<string, string> = {};
      const propList: { id: string; name: string }[] = [];
      for (const p of propsData) {
        propNames[p.id] = p.name;
        propList.push({ id: p.id, name: p.name });
      }
      if (!propList.length) { setRequests([]); return; }
      const propertyIds = propList.map(p => p.id);
      const reqRes = await fetch(`/api/supply-requests?propertyIds=${propertyIds.join(',')}`);
      if (!reqRes.ok) throw new Error('요청 내역을 불러오지 못했습니다.');
      const reqData = await reqRes.json();

      // Filter to only requests by current user
      const myRequests = reqData.filter((r: Record<string, unknown>) => r.requestedBy === user.id);

      const result = myRequests.map((r: Record<string, unknown>) => ({
        ...r,
        propertyName: propNames[r.propertyId as string] ?? '알 수 없는 숙소',
      })).sort((a: { createdAt: string }, b: { createdAt: string }) => b.createdAt.localeCompare(a.createdAt));

      setRequests(result as (SupplyRequest & { propertyName: string })[]);
    } catch (err) {
      console.error(err);
      setError('요청 내역을 불러오지 못했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <SkeletonList count={3} rows={2} />;
  }

  return (
    <div className="space-y-8">
      <header className="border-b border-stone-200 pb-6 mt-4 flex items-end justify-between">
        <div>
          <p className="text-[12px] tracking-[0.3em] text-stone-500 mb-2">비품 관리</p>
          <h1 className="text-2xl font-light tracking-tight text-stone-900">비품 요청</h1>
        </div>
        <Link
          href="/cleaner/records?mode=supplies"
          className="min-h-11 rounded-xl bg-stone-900 text-white px-4 py-2.5 text-sm font-semibold hover:bg-stone-800 transition-colors flex items-center gap-1.5"
        >
          <Plus size={14} /> 새 요청
        </Link>
      </header>
      <p className="text-sm text-stone-500">필요한 비품을 문장으로 적어 요청하고, 여기서 처리 상태를 확인하세요.</p>
      {error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p>{error}</p>
        <button type="button" onClick={() => void loadData()} className="mt-2 min-h-11 font-semibold underline underline-offset-4">다시 불러오기</button>
      </div>}

      {/* Requests List */}
      <section className="space-y-3">
        {requests.length === 0 && !error ? (
          <div className="flex flex-col items-center text-stone-400 py-12">
            <Package size={28} className="mb-3 opacity-50" />
            <p className="text-sm">비품 요청 내역이 없습니다.</p>
          </div>
        ) : (
          requests.map(req => {
            const st = SUPPLY_STATUS_CONFIG[req.status] ?? SUPPLY_STATUS_CONFIG.pending;
            return (
              <div key={req.id} className="border border-stone-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-stone-900 font-medium text-sm">{req.propertyName}</p>
                    <p className="text-stone-300 text-[12px] mt-0.5">
                      {format(parseISO(req.createdAt), 'M월 d일', { locale: ko })}
                    </p>
                  </div>
                  <span className={`text-[12px] px-1.5 py-0.5 tracking-wider ${st.bg} ${st.color}`}>{st.label}</span>
                </div>
                {req.urgency === 'urgent' && <p className="mb-2 text-sm font-medium text-red-600">긴급 요청</p>}
                <SupplyRequestContent request={req} />
                {req.statusNote && (
                  <p className="text-stone-400 text-xs mt-3 pt-3 border-t border-stone-100">메모: {req.statusNote}</p>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
