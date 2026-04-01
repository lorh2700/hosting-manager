'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, query, where, getDocs, setDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';

const CHANNELS = [
  { name: '에어비앤비', importUrl: 'https://www.airbnb.co.kr/calendar/ical/1368328600307420400.ics?t=05a24937c87945d5b442377911f43aad', isActive: true },
  { name: '부킹닷컴', importUrl: 'https://ical.booking.com/v1/export/t/18b830be-1e88-4cf0-8c1c-d956f2200b50.ics', isActive: true },
  { name: '아고다', importUrl: 'https://ycs.agoda.com/en-us/api/ari/icalendar?key=EMEc3kwoLjzeLjZ4Qf%2bFy4yekAZcefYz', isActive: true },
  { name: '스테이폴리오', importUrl: 'https://www.stayfolio.com/api/v1/icalendar/24050302.ics', isActive: true },
];

export default function SeedHwayeonjae() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [logs, setLogs] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const log = (msg: string) => setLogs(prev => [...prev, msg]);

  useEffect(() => {
    if (loading || !user) return;

    const run = async () => {
      log('화연재 숙소 검색 중...');
      const propSnap = await getDocs(query(collection(db, 'properties'), where('name', '==', '화연재')));

      if (propSnap.empty) {
        log('❌ 화연재 숙소를 찾을 수 없습니다.');
        return;
      }

      const propDoc = propSnap.docs[0];
      const propertyId = propDoc.id;
      log(`✅ 화연재 찾음 (ID: ${propertyId})`);

      // Delete existing channels
      log('기존 채널 삭제 중...');
      const existingSnap = await getDocs(query(collection(db, 'channels'), where('propertyId', '==', propertyId)));
      for (const ch of existingSnap.docs) {
        await deleteDoc(doc(db, 'channels', ch.id));
        log(`  삭제: ${ch.data().name}`);
      }

      // Add new channels
      log('새 채널 추가 중...');
      for (const ch of CHANNELS) {
        const channelId = crypto.randomUUID();
        await setDoc(doc(db, 'channels', channelId), {
          propertyId,
          name: ch.name,
          importUrl: ch.importUrl,
          exportUrl: `/api/export/${channelId}.ics`,
          isActive: ch.isActive,
          createdAt: new Date().toISOString(),
        });
        log(`  ✅ ${ch.name} 추가됨`);
      }

      log('');
      log('✅ 완료! 3초 후 채널 페이지로 이동합니다...');
      setDone(true);
      setTimeout(() => router.replace(`/admin/properties/${propertyId}/channels`), 3000);
    };

    run().catch(err => log(`❌ 오류: ${err.message}`));
  }, [user, loading, router]);

  return (
    <div className="max-w-xl mx-auto py-16 px-4">
      <h1 className="text-2xl font-light tracking-tight text-white mb-8">화연재 채널 설정</h1>
      <div className="bg-[#111] border border-white/10 p-6 font-mono text-sm space-y-1">
        {logs.length === 0 && <p className="text-white/40">초기화 중...</p>}
        {logs.map((l, i) => (
          <p key={i} className={l.startsWith('❌') ? 'text-red-400' : l.startsWith('✅') ? 'text-emerald-400' : 'text-white/60'}>{l}</p>
        ))}
        {!done && logs.length > 0 && (
          <span className="inline-block w-2 h-4 bg-white/60 animate-pulse ml-1" />
        )}
      </div>
    </div>
  );
}
