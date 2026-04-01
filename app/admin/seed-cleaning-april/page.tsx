'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';

// ────────────────────────────────────────────────────────────────────────────
// April 2026 cleaning schedule
// Format: { date, prop (Firestore name), cleaner }
// Source: combined from main schedule + additional dates
// Notes:
//   - "운화" (4/18) treated as 운와당
//   - 안온 4/20 removed (예약없음)
//   - Additional dates without assigned cleaner stored with cleaner: ''
// ────────────────────────────────────────────────────────────────────────────
const SCHEDULE: { date: string; prop: string; cleaner: string }[] = [
  { date: '2026-04-01', prop: '안온',  cleaner: '민' },
  { date: '2026-04-02', prop: '화연재', cleaner: '윤나' },
  { date: '2026-04-03', prop: '화연재', cleaner: '윤나' },
  { date: '2026-04-04', prop: '운와당', cleaner: '민' },
  { date: '2026-04-04', prop: '화연재', cleaner: '민' },
  { date: '2026-04-05', prop: '화연재', cleaner: '민' },
  { date: '2026-04-06', prop: '안온',  cleaner: '윤나' },
  { date: '2026-04-06', prop: '화연재', cleaner: '민' },
  { date: '2026-04-07', prop: '안온',  cleaner: '민' },
  { date: '2026-04-07', prop: '화연재', cleaner: '민' },
  { date: '2026-04-08', prop: '운와당', cleaner: '민' },
  { date: '2026-04-09', prop: '운와당', cleaner: '윤나' },
  { date: '2026-04-10', prop: '화연재', cleaner: '윤나' },
  { date: '2026-04-11', prop: '안온',  cleaner: '윤나' },
  { date: '2026-04-11', prop: '운와당', cleaner: '민' },
  { date: '2026-04-12', prop: '운와당', cleaner: '윤나' },
  { date: '2026-04-12', prop: '화연재', cleaner: '민' },
  { date: '2026-04-13', prop: '안온',  cleaner: '민' },
  { date: '2026-04-14', prop: '운와당', cleaner: '민' },  // 추가
  { date: '2026-04-16', prop: '화연재', cleaner: '윤나' },
  { date: '2026-04-16', prop: '안온',  cleaner: '민' },
  { date: '2026-04-17', prop: '화연재', cleaner: '민' },
  { date: '2026-04-17', prop: '안온',  cleaner: '민' },
  { date: '2026-04-18', prop: '운와당', cleaner: '민' },
  { date: '2026-04-19', prop: '안온',  cleaner: '민' },
  { date: '2026-04-20', prop: '화연재', cleaner: '윤나' },
  // 안온 4/20 제외 (예약없음)
  { date: '2026-04-20', prop: '운와당', cleaner: '민' },
  { date: '2026-04-22', prop: '화연재', cleaner: '민' },
  { date: '2026-04-23', prop: '안온',  cleaner: '윤나' },
  { date: '2026-04-25', prop: '화연재', cleaner: '윤나' },
  { date: '2026-04-25', prop: '안온',  cleaner: '윤나' },
  { date: '2026-04-27', prop: '화연재', cleaner: '윤나' },
  { date: '2026-04-28', prop: '운와당', cleaner: '민' },
  { date: '2026-04-28', prop: '안온',  cleaner: '민' },
  { date: '2026-04-29', prop: '화연재', cleaner: '민' },
];

export default function SeedCleaningApril() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [logs, setLogs] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const log = (msg: string) => setLogs(prev => [...prev, msg]);

  useEffect(() => {
    if (loading || !user) return;

    const run = async () => {
      // 1. Resolve property names → IDs (partial match)
      log('숙소 ID 조회 중...');
      const propsSnap = await getDocs(
        query(collection(db, 'properties'), where('ownerId', '==', user.uid))
      );
      // Build map: full name → id
      const allProps: { id: string; name: string }[] = propsSnap.docs.map(d => ({ id: d.id, name: d.data().name }));
      log(`  발견된 숙소: ${allProps.map(p => p.name).join(', ')}`);

      // Aliases: schedule key → keywords to match against Firestore name
      const ALIASES: Record<string, string[]> = {
        '운와당': ['운와'],
        '화연재': ['화연'],
        '안온':   ['안온'],
      };

      const nameToId: Record<string, string> = {};
      for (const [schedProp, keywords] of Object.entries(ALIASES)) {
        const match = allProps.find(p => keywords.some(kw => p.name.includes(kw)));
        if (match) {
          nameToId[schedProp] = match.id;
          log(`  매핑: "${schedProp}" → "${match.name}" (${match.id})`);
        }
      }

      const missing = [...new Set(SCHEDULE.map(s => s.prop))].filter(p => !nameToId[p]);
      if (missing.length > 0) {
        log(`❌ 다음 숙소를 찾을 수 없습니다: ${missing.join(', ')}`);
        log(`  발견된 숙소 이름: ${allProps.map(p => p.name).join(', ')}`);
        return;
      }

      // 2. Delete existing April 2026 cleanings
      log('기존 4월 청소 일정 삭제 중...');
      const existingSnap = await getDocs(
        query(collection(db, 'cleanings'), where('month', '==', '2026-04'))
      );
      const batch1 = writeBatch(db);
      existingSnap.docs.forEach(d => batch1.delete(d.ref));
      await batch1.commit();
      log(`  ${existingSnap.size}건 삭제됨`);

      // 3. Write new cleaning events (max 500 per batch)
      log(`새 청소 일정 ${SCHEDULE.length}건 저장 중...`);
      const batch2 = writeBatch(db);
      SCHEDULE.forEach(s => {
        const ref = doc(collection(db, 'cleanings'));
        batch2.set(ref, {
          propertyId: nameToId[s.prop],
          propertyName: s.prop,
          date: s.date,
          cleaner: s.cleaner,
          month: '2026-04',
          createdAt: new Date().toISOString(),
        });
      });
      await batch2.commit();
      log(`✅ ${SCHEDULE.length}건 저장 완료`);

      log('');
      log('✅ 완료! 3초 후 통합 캘린더로 이동합니다...');
      setDone(true);
      setTimeout(() => router.replace('/admin/calendar'), 3000);
    };

    run().catch(err => log(`❌ 오류: ${err.message}`));
  }, [user, loading, router]);

  return (
    <div className="max-w-xl mx-auto py-16 px-4">
      <h1 className="text-2xl font-light tracking-tight text-white mb-2">4월 청소 일정 시딩</h1>
      <p className="text-white/40 text-xs tracking-widest mb-8">기존 4월 데이터를 삭제하고 새로 입력합니다</p>
      <div className="bg-[#111] border border-white/10 rounded-xl p-6 font-mono text-sm space-y-1 min-h-[200px]">
        {logs.length === 0 && <p className="text-white/40">초기화 중...</p>}
        {logs.map((l, i) => (
          <p key={i} className={l.startsWith('❌') ? 'text-red-400' : l.startsWith('✅') ? 'text-emerald-400' : 'text-white/60'}>
            {l}
          </p>
        ))}
        {!done && logs.length > 0 && (
          <span className="inline-block w-2 h-4 bg-white/60 animate-pulse ml-1" />
        )}
      </div>
    </div>
  );
}
