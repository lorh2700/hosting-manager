'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { RefreshCw, ArrowRight, ArrowDownRight, ArrowUpRight, Sparkles, Check } from 'lucide-react';
import { collection, query, getDocs, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { parseISO, startOfToday, addDays, format, isToday, isTomorrow } from 'date-fns';
import { ko } from 'date-fns/locale';

interface Reservation {
  id: string;
  propertyId: string;
  propertyName: string;
  title: string;
  start: string;
  end: string;
}

interface Cleaning {
  propertyId: string;
  date: string;
  cleanerId: string;
  status: 'pending' | 'done';
}

interface DayGroup {
  date: string;
  label: string;
  isToday: boolean;
  isTomorrow: boolean;
  checkins: { reservation: Reservation; nights: number }[];
  checkouts: { reservation: Reservation; cleanerName: string; cleaningStatus: 'done' | 'pending' | 'unassigned' }[];
}

export default function Dashboard() {
  const [dayGroups, setDayGroups] = useState<DayGroup[]>([]);
  const [totalProperties, setTotalProperties] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const { user, profile } = useAuth();

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        const propsSnap = profile?.role === 'super_admin'
          ? await getDocs(collection(db, 'properties'))
          : await getDocs(query(collection(db, 'properties'), where('ownerId', '==', user.uid)));

        const propsMap = new Map<string, string>();
        propsSnap.docs.forEach(d => { propsMap.set(d.id, d.data().name); });
        const propIds = Array.from(propsMap.keys());
        setTotalProperties(propsSnap.size);
        if (propIds.length === 0) { setLoading(false); return; }

        const todayStr = format(startOfToday(), 'yyyy-MM-dd');
        const endStr = format(addDays(startOfToday(), 7), 'yyyy-MM-dd');

        // Fetch all reservations
        const allRes: Reservation[] = [];
        for (let i = 0; i < propIds.length; i += 10) {
          const chunk = propIds.slice(i, i + 10);
          const evtSnap = await getDocs(query(collection(db, 'events'), where('propertyId', 'in', chunk), where('type', '==', 'reservation')));
          evtSnap.docs.forEach(d => {
            const data = d.data();
            allRes.push({ id: d.id, propertyId: data.propertyId, propertyName: propsMap.get(data.propertyId) || '', title: data.title, start: data.start?.substring(0, 10), end: data.end?.substring(0, 10) });
          });
          const bkSnap = await getDocs(query(collection(db, 'bookings'), where('propertyId', 'in', chunk), where('status', '==', 'confirmed')));
          bkSnap.docs.forEach(d => {
            const data = d.data();
            allRes.push({ id: d.id, propertyId: data.propertyId, propertyName: propsMap.get(data.propertyId) || '', title: `${data.name}`, start: data.checkIn, end: data.checkOut });
          });
        }

        // Deduplicate
        const seen = new Set<string>();
        const unique = allRes.filter(r => {
          const key = `${r.propertyId}_${r.start}_${r.end}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Fetch cleanings + cleaners
        const cleaningsMap = new Map<string, Cleaning>();
        for (let i = 0; i < propIds.length; i += 10) {
          const snap = await getDocs(query(collection(db, 'cleanings'), where('propertyId', 'in', propIds.slice(i, i + 10))));
          snap.docs.forEach(d => {
            const c = d.data() as Cleaning;
            cleaningsMap.set(`${c.propertyId}_${c.date}`, c);
          });
        }
        const cleanersSnap = profile?.role === 'super_admin'
          ? await getDocs(collection(db, 'cleaners'))
          : await getDocs(query(collection(db, 'cleaners'), where('ownerId', '==', user.uid)));
        const cleanersMap = new Map(cleanersSnap.docs.map(d => [d.id, d.data().name as string]));

        // Build day groups
        const groups: DayGroup[] = [];
        for (let offset = 0; offset < 7; offset++) {
          const d = addDays(startOfToday(), offset);
          const dateStr = format(d, 'yyyy-MM-dd');

          const checkins = unique
            .filter(r => r.start === dateStr)
            .map(r => {
              const nights = Math.round((new Date(r.end).getTime() - new Date(r.start).getTime()) / 86400000);
              return { reservation: r, nights };
            });

          const checkouts = unique
            .filter(r => r.end === dateStr)
            .map(r => {
              const cleaning = cleaningsMap.get(`${r.propertyId}_${dateStr}`);
              const cleanerName = cleaning?.cleanerId ? (cleanersMap.get(cleaning.cleanerId) || '') : '';
              const cleaningStatus: 'done' | 'pending' | 'unassigned' = cleaning
                ? (cleaning.status === 'done' ? 'done' : 'pending')
                : 'unassigned';
              return { reservation: r, cleanerName, cleaningStatus };
            });

          if (checkins.length > 0 || checkouts.length > 0) {
            let label: string;
            if (isToday(d)) label = '오늘';
            else if (isTomorrow(d)) label = '내일';
            else label = format(d, 'M월 d일 (EEE)', { locale: ko });

            groups.push({
              date: dateStr,
              label,
              isToday: isToday(d),
              isTomorrow: isTomorrow(d),
              checkins,
              checkouts,
            });
          }
        }

        setDayGroups(groups);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMsg('');
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      if (res.ok) {
        setSyncMsg('완료');
        setTimeout(() => window.location.reload(), 800);
      } else {
        setSyncMsg('실패');
      }
    } catch {
      setSyncMsg('오류');
    } finally {
      setIsSyncing(false);
    }
  };

  // Summary stats
  const todayGroup = dayGroups.find(g => g.isToday);
  const todayIn = todayGroup?.checkins.length ?? 0;
  const todayOut = todayGroup?.checkouts.length ?? 0;
  const pendingCleanings = dayGroups.reduce(
    (sum, g) => sum + g.checkouts.filter(c => c.cleaningStatus !== 'done').length, 0
  );

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-6 h-6 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      {/* Header */}
      <header className="flex flex-col sm:flex-row gap-4 sm:justify-between sm:items-start">
        <div>
          <h1 className="text-2xl font-light tracking-tight text-white mb-1">
            {format(new Date(), 'M월 d일 EEEE', { locale: ko })}
          </h1>
          <p className="text-white/40 text-sm font-light">
            {totalProperties}개 숙소 운영 중
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-2 text-white/40 hover:text-white text-xs tracking-wide transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
          {isSyncing ? '동기화 중...' : syncMsg || '채널 동기화'}
        </button>
      </header>

      {/* Today's Key Numbers */}
      <div className="grid grid-cols-3 gap-3">
        <div className={`rounded-2xl p-5 text-center ${todayIn > 0 ? 'bg-emerald-500/[0.08] border border-emerald-500/20' : 'bg-white/[0.03] border border-white/[0.06]'}`}>
          <p className={`text-3xl font-light mb-1 ${todayIn > 0 ? 'text-emerald-400' : 'text-white/20'}`}>{todayIn}</p>
          <p className="text-[11px] text-white/40 tracking-wide">체크인</p>
        </div>
        <div className={`rounded-2xl p-5 text-center ${todayOut > 0 ? 'bg-amber-500/[0.08] border border-amber-500/20' : 'bg-white/[0.03] border border-white/[0.06]'}`}>
          <p className={`text-3xl font-light mb-1 ${todayOut > 0 ? 'text-amber-400' : 'text-white/20'}`}>{todayOut}</p>
          <p className="text-[11px] text-white/40 tracking-wide">체크아웃</p>
        </div>
        <div className={`rounded-2xl p-5 text-center ${pendingCleanings > 0 ? 'bg-rose-500/[0.08] border border-rose-500/20' : 'bg-white/[0.03] border border-white/[0.06]'}`}>
          <p className={`text-3xl font-light mb-1 ${pendingCleanings > 0 ? 'text-rose-400' : 'text-white/20'}`}>{pendingCleanings}</p>
          <p className="text-[11px] text-white/40 tracking-wide">청소 대기</p>
        </div>
      </div>

      {/* Day-by-day timeline */}
      <div className="space-y-2">
        {dayGroups.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-white/20 text-sm mb-4">이번 주 예정된 일정이 없습니다.</p>
            <Link href="/admin/calendar" className="text-white/40 hover:text-white text-xs tracking-wide inline-flex items-center gap-1 transition-colors">
              캘린더에서 확인 <ArrowRight size={12} />
            </Link>
          </div>
        ) : (
          dayGroups.map(group => (
            <div key={group.date} className={`rounded-2xl border overflow-hidden ${
              group.isToday ? 'border-white/15 bg-white/[0.03]' : 'border-white/[0.06] bg-white/[0.015]'
            }`}>
              {/* Day header */}
              <div className={`px-5 py-3.5 flex items-center gap-3 ${group.isToday ? 'border-b border-white/[0.08]' : 'border-b border-white/[0.04]'}`}>
                <span className={`text-sm font-medium ${group.isToday ? 'text-white' : 'text-white/50'}`}>
                  {group.label}
                </span>
                {group.isToday && (
                  <span className="text-[9px] bg-white/15 text-white/70 px-2 py-0.5 rounded-full font-medium tracking-wider">TODAY</span>
                )}
                <span className="text-[11px] text-white/25 ml-auto tabular-nums">
                  {group.date}
                </span>
              </div>

              {/* Events */}
              <div className="divide-y divide-white/[0.04]">
                {/* Check-ins */}
                {group.checkins.map(({ reservation: r, nights }) => (
                  <div key={r.id + '-in'} className="px-5 py-3.5 flex items-center gap-4">
                    <div className="w-8 flex justify-center shrink-0">
                      <ArrowDownRight size={16} className="text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-white/90 truncate">{r.title}</p>
                      <p className="text-[11px] text-white/35 mt-0.5">{r.propertyName} · {nights}박</p>
                    </div>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400/80 px-2.5 py-1 rounded-lg font-medium shrink-0">
                      체크인
                    </span>
                  </div>
                ))}

                {/* Check-outs + cleaning */}
                {group.checkouts.map(({ reservation: r, cleanerName, cleaningStatus }) => (
                  <div key={r.id + '-out'} className="px-5 py-3.5 flex items-center gap-4">
                    <div className="w-8 flex justify-center shrink-0">
                      <ArrowUpRight size={16} className="text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-white/90 truncate">{r.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-white/35">{r.propertyName}</span>
                        <span className="text-white/10">·</span>
                        {cleaningStatus === 'done' ? (
                          <span className="text-[11px] text-emerald-400/70 flex items-center gap-1">
                            <Check size={10} /> {cleanerName}
                          </span>
                        ) : cleaningStatus === 'pending' ? (
                          <span className="text-[11px] text-white/40 flex items-center gap-1">
                            <Sparkles size={10} /> {cleanerName}
                          </span>
                        ) : (
                          <span className="text-[11px] text-rose-400/70">청소 미배정</span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] bg-amber-500/10 text-amber-400/80 px-2.5 py-1 rounded-lg font-medium shrink-0">
                      체크아웃
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer link */}
      {dayGroups.length > 0 && (
        <div className="text-center pb-4">
          <Link href="/admin/calendar" className="text-white/30 hover:text-white/60 text-xs tracking-wide inline-flex items-center gap-1.5 transition-colors">
            전체 캘린더 보기 <ArrowRight size={12} />
          </Link>
        </div>
      )}
    </div>
  );
}
