'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Building, Plus, ChevronRight } from 'lucide-react';
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
  const { user, profile } = useAuth();

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
    <div className="max-w-5xl mx-auto space-y-8 sm:space-y-12">
      <header className="flex flex-col sm:flex-row gap-4 sm:justify-between sm:items-end border-b border-white/10 pb-6 sm:pb-8">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-white/50 mb-3 sm:mb-4">관리</p>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-light tracking-tight text-white">숙소 관리</h1>
          <p className="text-white/50 mt-2 sm:mt-4 text-sm font-light tracking-wide">숙소와 채널 연결을 관리하세요.</p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="bg-white text-black px-6 py-3 text-[11px] tracking-widest font-semibold flex items-center justify-center gap-3 hover:bg-white/90 active:scale-[0.98] transition-all shrink-0"
        >
          <Plus size={16} />
          숙소 추가
        </button>
      </header>

      {loading ? (
        <div className="text-center py-24 text-white/50 font-light tracking-widest text-[11px]">숙소를 불러오는 중...</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {properties.map((property) => (
              <Link
                key={property.id}
                href={`/admin/properties/${property.id}`}
                className="bg-[#111] p-6 sm:p-8 border border-white/10 hover:border-white/40 active:scale-[0.98] transition-all group flex flex-col rounded-2xl sm:rounded-none"
              >
                <div className="flex justify-between items-start mb-6 sm:mb-8">
                  <div className="text-white/50 group-hover:text-white transition-colors">
                    <Building size={24} strokeWidth={1.5} />
                  </div>
                  <div className="text-white/30 group-hover:text-white transition-colors">
                    <ChevronRight size={20} strokeWidth={1.5} />
                  </div>
                </div>
                <h2 className="text-lg sm:text-xl font-light text-white mb-2 tracking-wide">{property.name}</h2>
                <p className="text-[11px] tracking-widest text-white/40">시간대: {property.timezone}</p>
              </Link>
            ))}
          </div>
          {properties.length === 0 && (
            <div className="text-center py-24 bg-[#111] border border-white/10 border-dashed">
              <p className="text-white/50 font-light tracking-wide">등록된 숙소가 없습니다. 첫 번째 숙소를 추가하여 시작하세요.</p>
            </div>
          )}
        </div>
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-[#050505]/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 backdrop-blur-sm">
          <div className="bg-[#111] border border-white/10 p-6 sm:p-10 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl">
            <h2 className="text-xl font-light tracking-widest text-white mb-8">새 숙소 추가</h2>
            <p className="text-white/40 text-xs font-light mb-6 leading-relaxed">
              숙소를 추가한 후 채널 설정에서 iCal URL을 설정하세요.
            </p>
            <input
              type="text"
              value={newPropertyName}
              onChange={(e) => setNewPropertyName(e.target.value)}
              placeholder="숙소 이름을 입력하세요"
              className="w-full px-4 py-4 bg-transparent border border-white/20 text-white placeholder:text-white/30 focus:outline-none focus:border-white transition-colors mb-8 font-light"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddProperty(); }}
            />
            <div className="flex justify-end gap-4">
              <button
                onClick={() => { setIsAddModalOpen(false); setNewPropertyName(''); }}
                className="px-6 py-3 text-white/50 hover:text-white text-[11px] tracking-widest font-semibold transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleAddProperty}
                disabled={!newPropertyName.trim() || loading}
                className="px-6 py-3 bg-white text-black text-[11px] tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50"
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
