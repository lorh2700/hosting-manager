'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';

const PROPERTIES_TO_SEED = [
  {
    name: '운와당',
    timezone: 'Asia/Seoul',
    beds24PropId: '319544',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    address: '16-20 Bukchon-ro 11na-gil, Seoul, KR',
    phone: '821094222421',
    email: 'lorh2700@gmail.com',
    permit: '제2024-000026호 (한옥체험업, 서울특별시 종로구)',
    channels: [
      { name: 'Airbnb', importUrl: 'https://www.airbnb.co.kr/calendar/ical/992547788897590426.ics?t=f11aface071641e980dd0294d548e4eb', isActive: true },
      { name: 'Booking.com', importUrl: 'https://ical.booking.com/v1/export/t/7de8ba5d-d761-475d-bbdf-54a15df0b453.ics', isActive: true },
      { name: 'Stayfolio', importUrl: '', isActive: false },
    ],
  },
  {
    name: '화연재',
    timezone: 'Asia/Seoul',
    beds24PropId: null,
    checkInTime: '15:00',
    checkOutTime: '11:00',
    channels: [
      { name: 'Airbnb', importUrl: 'https://www.airbnb.co.kr/calendar/ical/1368328600307420400.ics?t=05a24937c87945d5b442377911f43aad', isActive: true },
      { name: 'Booking.com', importUrl: 'https://ical.booking.com/v1/export/t/c5870652-f9a6-4a12-809a-42916c8733a2.ics', isActive: true },
      { name: 'Stayfolio', importUrl: '', isActive: false },
    ],
  },
  {
    name: '안온',
    timezone: 'Asia/Seoul',
    beds24PropId: null,
    checkInTime: '15:00',
    checkOutTime: '11:00',
    channels: [
      { name: 'Airbnb', importUrl: 'https://www.airbnb.co.kr/calendar/ical/1586139517849528126.ics?t=25bab4d561f1421fb24f71b5504dc5a0', isActive: true },
      { name: 'Booking.com', importUrl: 'https://ical.booking.com/v1/export/t/10db37aa-0e0a-4952-80e4-ecc4c5a5c394.ics', isActive: true },
      { name: 'Stayfolio', importUrl: '', isActive: false },
    ],
  },
];

export default function QuickSeedPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState('확인 중...');

  useEffect(() => {
    if (loading || !user) return;

    const run = async () => {
      const existing = await getDocs(query(collection(db, 'properties'), where('ownerId', '==', user.uid)));
      const existingNames = existing.docs.map(d => d.data().name as string);

      const toAdd = PROPERTIES_TO_SEED.filter(p => !existingNames.includes(p.name));

      if (toAdd.length === 0) {
        setStatus('모든 숙소가 이미 등록되어 있습니다. 숙소 관리로 이동합니다...');
        setTimeout(() => router.replace('/admin/properties'), 1500);
        return;
      }

      for (const prop of toAdd) {
        setStatus(`${prop.name} 추가 중...`);
        const propRef = await addDoc(collection(db, 'properties'), {
          name: prop.name,
          timezone: prop.timezone,
          beds24PropId: prop.beds24PropId ?? null,
          checkInTime: prop.checkInTime ?? null,
          checkOutTime: prop.checkOutTime ?? null,
          address: (prop as any).address ?? null,
          phone: (prop as any).phone ?? null,
          email: (prop as any).email ?? null,
          permit: (prop as any).permit ?? null,
          ownerId: user.uid,
          createdAt: new Date().toISOString(),
        });

        for (const ch of prop.channels) {
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
      }

      setStatus(`완료! ${toAdd.map(p => p.name).join(', ')} 추가됨. 숙소 관리로 이동합니다...`);
      setTimeout(() => router.replace('/admin/properties'), 1500);
    };

    run().catch(err => setStatus(`오류: ${err.message}`));
  }, [user, loading]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
      <div className="w-6 h-6 border-t-2 border-white rounded-full animate-spin" />
      <p className="text-white/60 text-sm font-light tracking-widest">{status}</p>
    </div>
  );
}
