'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, deleteDoc, doc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { isAdminEmail } from '@/lib/adminConfig';

// Properties with different names that are actually the same place
const NAME_ALIASES: Record<string, string> = {
  '안온': '안온재',
};

function normalizePropertyName(name: string): string {
  return NAME_ALIASES[name] ?? name;
}

interface PropInfo {
  id: string;
  name: string;
  ownerId: string;
  eventCount: number;
  channelCount: number;
}

export default function CleanupPage() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Record<string, PropInfo[]>>({});
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    if (!user || !isAdminEmail(user.email)) return;

    const load = async () => {
      const propsSnap = await getDocs(collection(db, 'properties'));
      const props = propsSnap.docs.map(d => ({ id: d.id, name: d.data().name, ownerId: d.data().ownerId }));

      // Count events per property
      const eventsSnap = await getDocs(collection(db, 'events'));
      const eventCounts: Record<string, number> = {};
      eventsSnap.docs.forEach(d => {
        const pid = d.data().propertyId;
        eventCounts[pid] = (eventCounts[pid] ?? 0) + 1;
      });

      // Count channels per property
      const channelsSnap = await getDocs(collection(db, 'channels'));
      const channelCounts: Record<string, number> = {};
      channelsSnap.docs.forEach(d => {
        const pid = d.data().propertyId;
        channelCounts[pid] = (channelCounts[pid] ?? 0) + 1;
      });

      const grouped: Record<string, PropInfo[]> = {};
      props.forEach(p => {
        const key = normalizePropertyName(p.name);
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({
          id: p.id,
          name: p.name,
          ownerId: p.ownerId,
          eventCount: eventCounts[p.id] ?? 0,
          channelCount: channelCounts[p.id] ?? 0,
        });
      });

      setGroups(grouped);
      setLoading(false);
    };

    load();
  }, [user]);

  const handleCleanup = async () => {
    if (!confirm('중복 숙소를 삭제하시겠습니까? events가 가장 많은 숙소 1개만 남깁니다.')) return;
    setCleaning(true);
    const newLog: string[] = [];

    for (const [name, list] of Object.entries(groups)) {
      if (list.length <= 1) continue;

      // Keep the one with the most events; tie-break by most channels
      const sorted = [...list].sort((a, b) => b.eventCount - a.eventCount || b.channelCount - a.channelCount);
      const [keep, ...toDelete] = sorted;
      newLog.push(`[${name}] 유지: ${keep.id} (events: ${keep.eventCount})`);

      for (const p of toDelete) {
        // Delete associated channels
        const chSnap = await getDocs(query(collection(db, 'channels'), where('propertyId', '==', p.id)));
        for (const ch of chSnap.docs) {
          await deleteDoc(doc(db, 'channels', ch.id));
        }
        // Delete associated cleanings
        const clSnap = await getDocs(query(collection(db, 'cleanings'), where('propertyId', '==', p.id)));
        for (const cl of clSnap.docs) {
          await deleteDoc(doc(db, 'cleanings', cl.id));
        }
        // Delete property
        await deleteDoc(doc(db, 'properties', p.id));
        newLog.push(`  삭제: ${p.id} (events: ${p.eventCount})`);
      }
    }

    setLog(newLog);
    setCleaning(false);

    // Reload
    const propsSnap = await getDocs(collection(db, 'properties'));
    const props = propsSnap.docs.map(d => ({ id: d.id, name: d.data().name, ownerId: d.data().ownerId }));
    const eventsSnap = await getDocs(collection(db, 'events'));
    const eventCounts: Record<string, number> = {};
    eventsSnap.docs.forEach(d => { const pid = d.data().propertyId; eventCounts[pid] = (eventCounts[pid] ?? 0) + 1; });
    const channelsSnap = await getDocs(collection(db, 'channels'));
    const channelCounts: Record<string, number> = {};
    channelsSnap.docs.forEach(d => { const pid = d.data().propertyId; channelCounts[pid] = (channelCounts[pid] ?? 0) + 1; });
    const grouped: Record<string, PropInfo[]> = {};
    props.forEach(p => {
      const key = normalizePropertyName(p.name);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({ id: p.id, name: p.name, ownerId: p.ownerId, eventCount: eventCounts[p.id] ?? 0, channelCount: channelCounts[p.id] ?? 0 });
    });
    setGroups(grouped);
  };

  if (!isAdminEmail(user?.email)) {
    return <div className="text-white/50 p-8">접근 권한이 없습니다.</div>;
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 border-t-2 border-white rounded-full animate-spin" /></div>;
  }

  const hasDuplicates = Object.values(groups).some(list => list.length > 1);

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header className="border-b border-white/10 pb-6">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-3">유지보수</p>
        <h1 className="text-3xl font-light tracking-tight text-white">중복 숙소 정리</h1>
        <p className="text-white/40 mt-2 text-sm font-light">각 계정에서 중복 생성된 숙소를 정리합니다. events가 가장 많은 항목을 유지합니다.</p>
      </header>

      <div className="space-y-4">
        {Object.entries(groups).map(([name, list]) => (
          <div key={name} className={`bg-[#111] border p-5 rounded-xl ${list.length > 1 ? 'border-amber-500/40' : 'border-white/10'}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-white font-medium">{name}</span>
              {list.length > 1 && (
                <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-1 rounded-full tracking-widest">중복 {list.length}개</span>
              )}
            </div>
            <div className="space-y-2">
              {list.map(p => (
                <div key={p.id} className="flex items-center justify-between text-[11px] text-white/50 bg-black/30 px-3 py-2 rounded">
                  <span className="font-mono text-white/30 truncate max-w-[160px]">{p.id}</span>
                  <div className="flex gap-4">
                    <span>events: <span className={p.eventCount > 0 ? 'text-emerald-400' : 'text-white/30'}>{p.eventCount}</span></span>
                    <span>channels: {p.channelCount}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {hasDuplicates && (
        <button
          onClick={handleCleanup}
          disabled={cleaning}
          className="w-full bg-white text-black py-4 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50"
        >
          {cleaning ? '정리 중...' : '중복 숙소 자동 정리'}
        </button>
      )}

      {!hasDuplicates && log.length === 0 && (
        <p className="text-center text-white/40 text-sm py-8">중복 항목이 없습니다.</p>
      )}

      {log.length > 0 && (
        <div className="bg-[#0a0a0a] border border-white/10 rounded-xl p-5">
          <p className="text-[10px] tracking-widest text-white/40 mb-3">정리 결과</p>
          {log.map((line, i) => (
            <p key={i} className={`text-[11px] font-mono ${line.startsWith('  삭제') ? 'text-red-400/70' : 'text-emerald-400/70'}`}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
