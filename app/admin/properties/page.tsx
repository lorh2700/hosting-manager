'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Building, Plus, ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

interface Property {
  id: string;
  name: string;
  timezone: string;
  ownerId: string;
  organizationId?: string | null;
  organization?: { id: string; name: string } | null;
}

export default function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newPropertyName, setNewPropertyName] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const { user, profile, loading: authLoading } = useAuth();
  const loadController = useRef<AbortController | null>(null);
  const isSuper = profile?.role === 'super_admin';
  const userId = user?.id;
  const propertyScope = profile?.propertyIds.join(',');

  const fetchProperties = useCallback(async () => {
    if (!userId) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/properties', { cache: 'no-store', signal: controller.signal });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || '숙소 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      if (!Array.isArray(data) || data.some(property => !property || typeof property.id !== 'string' || typeof property.name !== 'string')) throw new Error('숙소 목록을 확인하지 못했습니다. 다시 불러와 주세요.');
      if (controller.signal.aborted) return;
      setProperties(data);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '숙소 목록을 불러오지 못했습니다.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setProperties([]);
    setError('');
    if (userId) void fetchProperties();
    else setLoading(authLoading);
    return () => loadController.current?.abort();
  }, [userId, profile?.role, profile?.organizationId, propertyScope, authLoading, fetchProperties]);

  useEffect(() => {
    setOrganizations([]);
    if (!userId || !isSuper) return;
    const controller = new AbortController();
    void fetch('/api/admin/organizations?picker=1', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (response.ok && !controller.signal.aborted && Array.isArray(data.organizations)) setOrganizations(data.organizations.filter((item: { status: string }) => item.status === 'active'));
    }).catch(() => {});
    return () => controller.abort();
  }, [userId, isSuper]);

  const handleAddProperty = async () => {
    if (!user || !newPropertyName.trim() || adding) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPropertyName.trim(), organizationId: organizationId || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || '숙소 추가에 실패했습니다.');
      setNewPropertyName('');
      setOrganizationId('');
      setIsAddModalOpen(false);
      await fetchProperties();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : '숙소 추가에 실패했습니다.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 sm:space-y-10">
      <header className="flex flex-col sm:flex-row gap-4 sm:justify-between sm:items-end border-b border-stone-200 pb-6 sm:pb-7">
        <div>
          <p className="text-[13px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">관리</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">숙소 관리</h1>
          <p className="text-stone-500 mt-2 text-sm">숙소와 채널 연결을 관리하세요.</p>
        </div>
        {isSuper ? <button
          onClick={() => { setAddError(''); setIsAddModalOpen(true); }}
          className="bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white text-xs font-semibold uppercase tracking-widest px-5 py-2.5 flex items-center justify-center gap-2 active:scale-[0.98] transition-colors shrink-0"
        >
          <Plus size={15} />
          숙소 추가
        </button> : profile?.role === 'admin' ? <Link href="/admin/settings?tab=requests" className="inline-flex min-h-11 items-center justify-center gap-2 border border-stone-300 bg-white px-5 text-sm"><Plus size={15} />지점 추가 요청</Link> : null}
      </header>

      {error && <div role="alert" className="border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{error}</p><button type="button" onClick={() => void fetchProperties()} disabled={loading} className="mt-3 min-h-11 border border-red-300 bg-white px-4 disabled:opacity-50">다시 불러오기</button></div>}

      {loading ? (
        <div role="status" aria-label="숙소 목록을 불러오는 중" className="flex items-center justify-center py-24">
          <Loader2 size={20} className="animate-spin text-[var(--brand)]" />
        </div>
      ) : (
        <>
          {properties.length === 0 && !error ? (
            <div className="text-center py-20 bg-white border border-dashed border-stone-200">
              <Building size={28} strokeWidth={1.5} className="mx-auto mb-4 text-stone-300" />
              <p className="text-stone-500 text-sm mb-1">{isSuper ? '등록된 숙소가 없습니다.' : '현재 계정에 연결된 숙소가 없습니다.'}</p>
              <p className="text-stone-400 text-xs">{isSuper ? '숙소를 추가하거나 사업자 설정에서 지점을 확인해 주세요.' : profile?.role === 'admin' && !profile.organizationId ? '소속 사업자가 지정되지 않았습니다. 슈퍼매니저에게 소속 설정을 요청해 주세요.' : '사업자 관리자에게 소속과 담당 숙소 배정을 확인해 주세요.'}</p>
              {isSuper && <Link href="/admin/settings?tab=organizations" className="mt-4 inline-flex min-h-11 items-center border border-stone-300 px-4 text-sm">사업자 설정 확인</Link>}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {properties.map((property) => (
                <Link
                  key={property.id}
                  href={`/admin/properties/${property.id}`}
                  className="group bg-white hover:bg-stone-50 border border-stone-200 hover:border-stone-300 p-5 sm:p-6 active:scale-[0.99] transition-all flex flex-col"
                >
                  <div className="flex justify-between items-start mb-5">
                    <div className="w-10 h-10 bg-[var(--brand-tint)] flex items-center justify-center text-[var(--brand-dark)]">
                      <Building size={18} strokeWidth={1.7} />
                    </div>
                    <ChevronRight size={18} className="text-stone-300 group-hover:text-stone-700 transition-colors" />
                  </div>
                  <h2 className="text-base sm:text-lg font-semibold text-stone-900 mb-1 truncate">{property.name}</h2>
                  <p className="text-xs text-stone-500">{property.organization?.name || '사업자 미지정'} · {property.timezone}</p>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-stone-950/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 backdrop-blur-sm">
          <div className="bg-white border border-stone-200 p-6 sm:p-8 w-full sm:max-w-md shadow-2xl">
            <h2 className="text-lg font-semibold text-stone-900 mb-2">새 숙소 추가</h2>
            <p className="text-stone-500 text-sm mb-5">
              숙소를 추가한 후 채널 설정에서 iCal URL을 설정하세요.
            </p>
            <input
              type="text"
              value={newPropertyName}
              onChange={(e) => setNewPropertyName(e.target.value)}
              placeholder="숙소 이름을 입력하세요"
              className="w-full bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors mb-6"
              autoFocus
              disabled={adding}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddProperty(); }}
            />
            <label className="mb-6 block text-sm">소속 사업자<select disabled={adding} className="mt-2 w-full border border-stone-200 px-4 py-3" value={organizationId} onChange={event => setOrganizationId(event.target.value)}><option value="">사업자 미지정</option>{organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            {addError && <p role="alert" className="mb-4 text-sm text-red-700">{addError}</p>}
            <div className="flex justify-end gap-2">
              <button
                disabled={adding}
                onClick={() => { setIsAddModalOpen(false); setNewPropertyName(''); setOrganizationId(''); setAddError(''); }}
                className="px-5 py-2.5 text-stone-700 hover:text-stone-900 text-sm font-medium transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleAddProperty}
                disabled={!newPropertyName.trim() || adding}
                className="px-5 py-2.5 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-50"
              >
                {adding ? '추가 중...' : '추가하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
