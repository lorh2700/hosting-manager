'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Building, Plus, ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

interface Property {
  id: string;
  name: string;
  timezone: string;
  ownerId: string;
}

export default function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newPropertyName, setNewPropertyName] = useState('');
  const { user } = useAuth();

  const fetchProperties = async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/properties');
      if (!res.ok) throw new Error('Failed to fetch properties');
      const data = await res.json();
      setProperties(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProperties();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleAddProperty = async () => {
    if (!user || !newPropertyName.trim()) return;
    setLoading(true);
    setIsAddModalOpen(false);
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPropertyName.trim() }),
      });
      if (!res.ok) throw new Error('Failed to add property');
      setNewPropertyName('');
      await fetchProperties();
    } catch (error) {
      console.error('Failed to add property', error);
      alert('숙소 추가에 실패했습니다.');
    } finally {
      setLoading(false);
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
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white text-xs font-semibold uppercase tracking-widest px-5 py-2.5 flex items-center justify-center gap-2 active:scale-[0.98] transition-colors shrink-0"
        >
          <Plus size={15} />
          숙소 추가
        </button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={20} className="animate-spin text-[var(--brand)]" />
        </div>
      ) : (
        <>
          {properties.length === 0 ? (
            <div className="text-center py-20 bg-white border border-dashed border-stone-200">
              <Building size={28} strokeWidth={1.5} className="mx-auto mb-4 text-stone-300" />
              <p className="text-stone-500 text-sm mb-1">등록된 숙소가 없습니다.</p>
              <p className="text-stone-400 text-xs">첫 번째 숙소를 추가하여 시작하세요.</p>
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
                  <p className="text-xs text-stone-500">시간대: {property.timezone}</p>
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
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddProperty(); }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setIsAddModalOpen(false); setNewPropertyName(''); }}
                className="px-5 py-2.5 text-stone-700 hover:text-stone-900 text-sm font-medium transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleAddProperty}
                disabled={!newPropertyName.trim() || loading}
                className="px-5 py-2.5 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-50"
              >
                {loading ? '추가 중...' : '추가하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
