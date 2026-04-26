'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Users, Save, Search } from 'lucide-react';

interface GuestRecord {
  id: string;
  name: string;
  email: string;
  phone?: string;
  bookingCount: number;
  lastStayAt?: string;
  notes?: string;
  source: string;
  createdAt: string;
}

const SOURCE_LABELS: Record<string, string> = {
  direct: '직접 예약',
  airbnb: 'Airbnb',
  booking: 'Booking.com',
  beds24: 'Beds24',
  stayfolio: 'Stayfolio',
  agoda: 'Agoda',
};

export default function GuestsPage() {
  const { profile } = useAuth();
  const [guests, setGuests] = useState<GuestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/guests?orderBy=createdAt&order=desc');
        if (!res.ok) throw new Error('Failed to fetch guests');
        const data: GuestRecord[] = await res.json();
        setGuests(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleUpdateNotes = async (guestId: string, notes: string) => {
    setSavingId(guestId);
    try {
      const res = await fetch('/api/guests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: guestId,
          notes,
          updatedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error('Failed to update guest notes');
      setGuests(prev => prev.map(g => g.id === guestId ? { ...g, notes } : g));
    } catch (err) {
      console.error(err);
    } finally {
      setSavingId(null);
    }
  };

  const filteredGuests = searchQuery
    ? guests.filter(g =>
        g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        g.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (g.phone && g.phone.includes(searchQuery))
      )
    : guests;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-[var(--brand)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-12">
      <header className="border-b border-stone-200 pb-8">
        <p className="text-[10px] tracking-[0.3em] text-stone-500 mb-4">관리</p>
        <h1 className="text-3xl md:text-4xl font-light tracking-tight text-stone-900">게스트 관리</h1>
        <p className="text-stone-500 mt-4 text-sm font-light tracking-wide">
          총 {guests.length}명의 게스트 &middot; 재방문 추적 및 메모를 관리합니다.
        </p>
      </header>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="이름, 이메일, 연락처로 검색..."
          className="w-full bg-white border border-stone-200 pl-12 pr-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
        />
      </div>

      {/* Guest List */}
      {filteredGuests.length === 0 ? (
        <div className="bg-white border border-stone-200 p-12 text-center flex flex-col items-center text-stone-400">
          <Users size={32} className="mb-4 opacity-50" />
          <p className="text-sm">{searchQuery ? '검색 결과가 없습니다.' : '등록된 게스트가 없습니다.'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGuests.map(guest => (
            <div key={guest.id} className="bg-white border border-stone-200 p-5 hover:border-stone-300 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-stone-900 font-medium text-sm">{guest.name}</span>
                    <span className={`text-[9px] px-2 py-0.5 tracking-wider ${
                      guest.bookingCount >= 3 ? 'bg-amber-50 text-amber-600' :
                      guest.bookingCount >= 2 ? 'bg-blue-50 text-blue-600' :
                      'bg-stone-100 text-stone-500'
                    }`}>
                      {guest.bookingCount}회 방문
                    </span>
                    <span className="text-[9px] text-stone-400">{SOURCE_LABELS[guest.source] ?? guest.source}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-stone-500">
                    <span>{guest.email}</span>
                    {guest.phone && <span>{guest.phone}</span>}
                    {guest.lastStayAt && <span>마지막 투숙: {guest.lastStayAt}</span>}
                  </div>
                </div>

                <div className="flex items-end gap-2 w-full sm:w-auto">
                  <div className="flex-1 sm:w-64">
                    <label className="block text-[9px] uppercase tracking-widest text-stone-400 mb-1">메모</label>
                    <input
                      type="text"
                      defaultValue={guest.notes ?? ''}
                      onBlur={e => {
                        if (e.target.value !== (guest.notes ?? '')) {
                          handleUpdateNotes(guest.id, e.target.value);
                        }
                      }}
                      placeholder="VIP, 알레르기, 선호사항..."
                      className="w-full bg-white border border-stone-200 px-3 py-2 text-xs text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                    />
                  </div>
                  {savingId === guest.id && (
                    <div className="p-2">
                      <Save size={12} className="text-emerald-600 animate-pulse" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
