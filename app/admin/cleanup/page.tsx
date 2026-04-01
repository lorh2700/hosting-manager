'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, deleteDoc, doc, query, where, setDoc } from 'firebase/firestore';
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

// Missing channels to restore per property name
const MISSING_CHANNELS: Record<string, { name: string; importUrl: string }[]> = {
  '화연재': [
    { name: 'Agoda', importUrl: 'https://ycs.agoda.com/en-us/api/ari/icalendar?key=EMEc3kwoLjzeLjZ4Qf%2bFy4yekAZcefYz' },
  ],
};

export default function CleanupPage() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Record<string, PropInfo[]>>({});
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [channelLog, setChannelLog] = useState<string[]>([]);
  const [restoringChannels, setRestoringChannels] = useState(false);
  const [migrationLog, setMigrationLog] = useState<string[]>([]);
  const [migrating, setMigrating] = useState(false);

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

      // Count channels per property (subcollection)
      const channelCounts: Record<string, number> = {};
      for (const p of props) {
        const chSnap = await getDocs(collection(db, 'properties', p.id, 'channels'));
        channelCounts[p.id] = chSnap.size;
      }

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
        // Delete associated channels (subcollection)
        const chSnap = await getDocs(collection(db, 'properties', p.id, 'channels'));
        for (const ch of chSnap.docs) {
          await deleteDoc(ch.ref);
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
    const channelCounts: Record<string, number> = {};
    for (const p of props) {
      const chSnap = await getDocs(collection(db, 'properties', p.id, 'channels'));
      channelCounts[p.id] = chSnap.size;
    }
    const grouped: Record<string, PropInfo[]> = {};
    props.forEach(p => {
      const key = normalizePropertyName(p.name);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({ id: p.id, name: p.name, ownerId: p.ownerId, eventCount: eventCounts[p.id] ?? 0, channelCount: channelCounts[p.id] ?? 0 });
    });
    setGroups(grouped);
  };

  const handleRestoreChannels = async () => {
    setRestoringChannels(true);
    const newLog: string[] = [];
    try {
      const propsSnap = await getDocs(collection(db, 'properties'));
      for (const propDoc of propsSnap.docs) {
        const propName = propDoc.data().name as string;
        const missing = MISSING_CHANNELS[propName];
        if (!missing) continue;

        const existingSnap = await getDocs(collection(db, 'properties', propDoc.id, 'channels'));
        const existingNames = new Set(existingSnap.docs.map(d => d.id));

        for (const ch of missing) {
          if (existingNames.has(ch.name)) {
            newLog.push(`[${propName}] ${ch.name}: 이미 존재`);
            continue;
          }
          const token = Math.random().toString(36).substring(2, 15);
          await setDoc(doc(db, 'properties', propDoc.id, 'channels', ch.name), {
            importUrl: ch.importUrl,
            exportUrl: `/api/export/${token}.ics`,
            isActive: true,
            createdAt: new Date().toISOString(),
          });
          newLog.push(`[${propName}] ${ch.name}: 추가 완료`);
        }
      }
    } catch (err) {
      console.error(err);
      newLog.push('오류 발생: ' + String(err));
    } finally {
      setRestoringChannels(false);
      setChannelLog(newLog);
    }
  };

  const handleMigrateChannels = async () => {
    if (!confirm('flat channels 컬렉션을 subcollection으로 마이그레이션합니다. 계속하시겠습니까?')) return;
    setMigrating(true);
    const newLog: string[] = [];
    try {
      const flatSnap = await getDocs(collection(db, 'channels'));
      if (flatSnap.empty) { newLog.push('flat channels 컬렉션이 비어있습니다. 이미 마이그레이션 완료됐을 수 있습니다.'); }
      for (const ch of flatSnap.docs) {
        const d = ch.data();
        const propId = d.propertyId as string;
        const name = d.name as string;
        if (!propId || !name) { newLog.push(`SKIP ${ch.id}: propertyId 또는 name 없음`); continue; }
        await setDoc(doc(db, 'properties', propId, 'channels', name), {
          importUrl: d.importUrl ?? '',
          exportUrl: d.exportUrl ?? '',
          isActive: d.isActive ?? false,
          createdAt: d.createdAt ?? new Date().toISOString(),
        });
        await deleteDoc(ch.ref);
        newLog.push(`✓ ${name} → properties/${propId}/channels/${name}`);
      }
      newLog.push('마이그레이션 완료!');
    } catch (err) {
      newLog.push('오류: ' + String(err));
    } finally {
      setMigrating(false);
      setMigrationLog(newLog);
    }
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

      {/* Channel Restore Section */}
      <div className="border-t border-white/10 pt-8 space-y-4">
        <div>
          <h2 className="text-base font-light text-white mb-1">누락 채널 복구</h2>
          <p className="text-white/40 text-xs">삭제된 숙소의 채널 정보를 다시 등록합니다.</p>
          <ul className="mt-3 space-y-1">
            {Object.entries(MISSING_CHANNELS).map(([prop, chs]) => chs.map(ch => (
              <li key={`${prop}-${ch.name}`} className="text-[11px] text-white/50 font-mono">
                {prop} → {ch.name}
              </li>
            )))}
          </ul>
        </div>
        <button
          onClick={handleRestoreChannels}
          disabled={restoringChannels}
          className="w-full border border-white/20 text-white py-4 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          {restoringChannels ? '복구 중...' : '누락 채널 복구'}
        </button>
        {channelLog.length > 0 && (
          <div className="bg-[#0a0a0a] border border-white/10 rounded-xl p-5">
            {channelLog.map((line, i) => (
              <p key={i} className={`text-[11px] font-mono ${line.includes('완료') ? 'text-emerald-400/70' : 'text-white/40'}`}>{line}</p>
            ))}
          </div>
        )}
      </div>

      {/* Migration Section */}
      <div className="border-t border-white/10 pt-8 space-y-4">
        <div>
          <h2 className="text-base font-light text-white mb-1">채널 DB 구조 마이그레이션</h2>
          <p className="text-white/40 text-xs leading-relaxed">
            flat <code className="text-white/60">channels</code> 컬렉션 →{' '}
            <code className="text-white/60">properties/&#123;id&#125;/channels/&#123;name&#125;</code> subcollection<br />
            채널명이 키가 되어 숙소당 채널 1개씩만 존재합니다.
          </p>
        </div>
        <button
          onClick={handleMigrateChannels}
          disabled={migrating}
          className="w-full border border-amber-500/30 text-amber-400/80 py-4 text-[11px] uppercase tracking-widest font-semibold hover:bg-amber-500/10 transition-colors disabled:opacity-50"
        >
          {migrating ? '마이그레이션 중...' : 'channels 컬렉션 마이그레이션'}
        </button>
        {migrationLog.length > 0 && (
          <div className="bg-[#0a0a0a] border border-white/10 rounded-xl p-5 max-h-60 overflow-y-auto">
            {migrationLog.map((line, i) => (
              <p key={i} className={`text-[11px] font-mono ${line.startsWith('✓') ? 'text-emerald-400/70' : line.includes('오류') || line.startsWith('SKIP') ? 'text-red-400/70' : 'text-white/50'}`}>{line}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
