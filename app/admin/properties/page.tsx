'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Building, Plus, ChevronRight } from 'lucide-react';
import { collection, query, getDocs, addDoc, orderBy, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { isAdminEmail } from '@/lib/adminConfig';

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
      const snapshot = isAdminEmail(user.email)
        ? await getDocs(query(collection(db, 'properties'), orderBy('createdAt', 'desc')))
        : await getDocs(query(collection(db, 'properties'), where('ownerId', '==', user.uid), orderBy('createdAt', 'desc')));
      setProperties(snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
        timezone: doc.data().timezone,
        ownerId: doc.data().ownerId,
      })));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProperties();
  }, [user]);

  const PRESET_PROPERTIES: Record<string, { beds24PropId: string; checkInTime: string; checkOutTime: string; channels: { name: string; importUrl: string; isActive: boolean }[] }> = {
    '운와당': {
      beds24PropId: '319544',
      checkInTime: '15:00',
      checkOutTime: '11:00',
      channels: [
        { name: 'Airbnb', importUrl: 'https://www.airbnb.co.kr/calendar/ical/992547788897590426.ics?t=f11aface071641e980dd0294d548e4eb', isActive: true },
        { name: 'Booking.com', importUrl: 'https://ical.booking.com/v1/export/t/7de8ba5d-d761-475d-bbdf-54a15df0b453.ics', isActive: true },
        { name: 'Stayfolio', importUrl: '', isActive: false },
      ],
    },
    '화연재': {
      beds24PropId: '',
      checkInTime: '15:00',
      checkOutTime: '11:00',
      channels: [
        { name: 'Airbnb', importUrl: 'https://www.airbnb.co.kr/calendar/ical/1368328600307420400.ics?t=05a24937c87945d5b442377911f43aad', isActive: true },
        { name: 'Booking.com', importUrl: 'https://ical.booking.com/v1/export/t/c5870652-f9a6-4a12-809a-42916c8733a2.ics', isActive: true },
        { name: 'Agoda', importUrl: 'https://ycs.agoda.com/en-us/api/ari/icalendar?key=EMEc3kwoLjzeLjZ4Qf%2bFy4yekAZcefYz', isActive: true },
        { name: 'Stayfolio', importUrl: '', isActive: false },
      ],
    },
    '안온': {
      beds24PropId: '',
      checkInTime: '15:00',
      checkOutTime: '11:00',
      channels: [
        { name: 'Airbnb', importUrl: 'https://www.airbnb.co.kr/calendar/ical/1586139517849528126.ics?t=25bab4d561f1421fb24f71b5504dc5a0', isActive: true },
        { name: 'Booking.com', importUrl: 'https://ical.booking.com/v1/export/t/10db37aa-0e0a-4952-80e4-ecc4c5a5c394.ics', isActive: true },
        { name: 'Stayfolio', importUrl: '', isActive: false },
      ],
    },
  };

  const addPropertyWithChannels = async (name: string) => {
    if (!user) return;
    const preset = PRESET_PROPERTIES[name];
    const propRef = await addDoc(collection(db, 'properties'), {
      name,
      timezone: 'Asia/Seoul',
      beds24PropId: preset?.beds24PropId || null,
      checkInTime: preset?.checkInTime || null,
      checkOutTime: preset?.checkOutTime || null,
      ownerId: user.uid,
      createdAt: new Date().toISOString(),
    });
    const defaultChannels = preset?.channels ?? [
      { name: 'Airbnb', importUrl: '', isActive: false },
      { name: 'Booking.com', importUrl: '', isActive: false },
      { name: 'Stayfolio', importUrl: '', isActive: false },
    ];
    for (const ch of defaultChannels) {
      const token = Math.random().toString(36).substring(2, 15);
      await addDoc(collection(db, 'channels'), {
        propertyId: propRef.id,
        name: ch.name,
        importUrl: ch.importUrl,
        exportUrl: `/api/export/${token}.ics`,
        isActive: ch.isActive,
        createdAt: new Date().toISOString(),
      });
    }
    return propRef.id;
  };

  const handleAddProperty = async () => {
    if (!user || !newPropertyName.trim()) return;
    setLoading(true);
    setIsAddModalOpen(false);
    try {
      await addPropertyWithChannels(newPropertyName.trim());
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
    <div className="max-w-5xl mx-auto space-y-12">
      <header className="flex flex-col sm:flex-row gap-4 sm:justify-between sm:items-end border-b border-white/10 pb-8">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-white/50 mb-4">관리</p>
          <h1 className="text-3xl md:text-4xl font-light tracking-tight text-white">숙소 관리</h1>
          <p className="text-white/50 mt-4 text-sm font-light tracking-wide">숙소와 채널 연결을 관리하세요.</p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="bg-white text-black px-6 py-3 text-[11px] tracking-widest font-semibold flex items-center justify-center gap-3 hover:bg-white/90 transition-colors shrink-0"
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
                className="bg-[#111] p-8 border border-white/10 hover:border-white/40 transition-all group flex flex-col"
              >
                <div className="flex justify-between items-start mb-8">
                  <div className="text-white/50 group-hover:text-white transition-colors">
                    <Building size={24} strokeWidth={1.5} />
                  </div>
                  <div className="text-white/30 group-hover:text-white transition-colors">
                    <ChevronRight size={20} strokeWidth={1.5} />
                  </div>
                </div>
                <h2 className="text-xl font-light text-white mb-2 tracking-wide">{property.name}</h2>
                <p className="text-[10px] tracking-widest text-white/40">시간대: {property.timezone}</p>
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
        <div className="fixed inset-0 bg-[#050505]/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-[#111] border border-white/10 p-10 w-full max-w-md">
            <h2 className="text-xl font-light tracking-widest text-white mb-8">새 숙소 추가</h2>
            <p className="text-white/40 text-xs font-light mb-6 leading-relaxed">
              운와당, 화연재, 안온은 채널(iCal URL)이 자동으로 설정됩니다.<br />
              그 외 이름을 입력하면 빈 채널로 생성됩니다.
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
