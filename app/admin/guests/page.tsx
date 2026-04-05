'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
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
        const snap = await getDocs(query(collection(db, 'guests'), orderBy('createdAt', 'desc')));
        setGuests(snap.docs.map(d => ({ id: d.id, ...d.data() } as GuestRecord)));
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
      await updateDoc(doc(db, 'guests', guestId), {
        notes,
        updatedAt: new Date().toISOString(),
      });
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
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-12">
      <header className="border-b border-white/10 pb-8">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-4">관리</p>
        <h1 className="text-3xl md:text-4xl font-light tracking-tight text-white">게스트 관리</h1>
        <p className="text-white/50 mt-4 text-sm font-light tracking-wide">
          총 {guests.length}명의 게스트 &middot; 재방문 추적 및 메모를 관리합니다.
        </p>
      </header>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="이름, 이메일, 연락처로 검색..."
          className="w-full bg-[#111] border border-white/10 pl-12 pr-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
        />
      </div>

      {/* Guest List */}
      {filteredGuests.length === 0 ? (
        <div className="bg-[#111] border border-white/10 p-12 text-center flex flex-col items-center text-white/40">
          <Users size={32} className="mb-4 opacity-50" />
          <p className="text-sm">{searchQuery ? '검색 결과가 없습니다.' : '등록된 게스트가 없습니다.'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGuests.map(guest => (
            <div key={guest.id} className="bg-[#111] border border-white/10 p-5 hover:border-white/30 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-white font-medium text-sm">{guest.name}</span>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full tracking-wider ${
                      guest.bookingCount >= 3 ? 'bg-amber-500/20 text-amber-400' :
                      guest.bookingCount >= 2 ? 'bg-blue-500/20 text-blue-400' :
                      'bg-white/5 text-white/40'
                    }`}>
                      {guest.bookingCount}회 방문
                    </span>
                    <span className="text-[9px] text-white/30">{SOURCE_LABELS[guest.source] ?? guest.source}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-white/40">
                    <span>{guest.email}</span>
                    {guest.phone && <span>{guest.phone}</span>}
                    {guest.lastStayAt && <span>마지막 투숙: {guest.lastStayAt}</span>}
                  </div>
                </div>

                <div className="flex items-end gap-2 w-full sm:w-auto">
                  <div className="flex-1 sm:w-64">
                    <label className="block text-[9px] uppercase tracking-widest text-white/30 mb-1">메모</label>
                    <input
                      type="text"
                      defaultValue={guest.notes ?? ''}
                      onBlur={e => {
                        if (e.target.value !== (guest.notes ?? '')) {
                          handleUpdateNotes(guest.id, e.target.value);
                        }
                      }}
                      placeholder="VIP, 알레르기, 선호사항..."
                      className="w-full bg-black/50 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-white/30 transition-colors"
                    />
                  </div>
                  {savingId === guest.id && (
                    <div className="p-2">
                      <Save size={12} className="text-emerald-400 animate-pulse" />
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
