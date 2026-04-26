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
      <header className="flex flex-col sm:flex-row gap-4 sm:justify-between sm:items-end border-b border-white/[0.06] pb-6 sm:pb-7">
        <div>
          <p className="text-xs text-violet-300/80 mb-2 font-medium">관리</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">숙소 관리</h1>
          <p className="text-white/50 mt-2 text-sm">숙소와 채널 연결을 관리하세요.</p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold px-5 py-2.5 rounded-full flex items-center justify-center gap-2 active:scale-[0.98] transition-colors shrink-0"
        >
          <Plus size={15} />
          숙소 추가
        </button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={20} className="animate-spin text-violet-400" />
        </div>
      ) : (
        <>
          {properties.length === 0 ? (
            <div className="text-center py-20 bg-white/[0.03] border border-dashed border-white/[0.08] rounded-2xl">
              <Building size={28} strokeWidth={1.5} className="mx-auto mb-4 text-white/20" />
              <p className="text-white/55 text-sm mb-1">등록된 숙소가 없습니다.</p>
              <p className="text-white/30 text-xs">첫 번째 숙소를 추가하여 시작하세요.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {properties.map((property) => (
                <Link
                  key={property.id}
                  href={`/admin/properties/${property.id}`}
                  className="group bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl p-5 sm:p-6 active:scale-[0.99] transition-all flex flex-col"
                >
                  <div className="flex justify-between items-start mb-5">
                    <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center text-violet-300">
                      <Building size={18} strokeWidth={1.7} />
                    </div>
                    <ChevronRight size={18} className="text-white/30 group-hover:text-white/70 transition-colors" />
                  </div>
                  <h2 className="text-base sm:text-lg font-semibold text-white mb-1 truncate">{property.name}</h2>
                  <p className="text-xs text-white/45">시간대: {property.timezone}</p>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 backdrop-blur-sm">
          <div className="bg-[#141416] border border-white/[0.08] p-6 sm:p-8 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl">
            <h2 className="text-lg font-semibold text-white mb-2">새 숙소 추가</h2>
            <p className="text-white/55 text-sm mb-5">
              숙소를 추가한 후 채널 설정에서 iCal URL을 설정하세요.
            </p>
            <input
              type="text"
              value={newPropertyName}
              onChange={(e) => setNewPropertyName(e.target.value)}
              placeholder="숙소 이름을 입력하세요"
              className="w-full bg-black/30 border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-violet-400/60 transition-colors mb-6"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddProperty(); }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setIsAddModalOpen(false); setNewPropertyName(''); }}
                className="px-5 py-2.5 text-white/65 hover:text-white text-sm font-medium transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleAddProperty}
                disabled={!newPropertyName.trim() || loading}
                className="px-5 py-2.5 bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
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
