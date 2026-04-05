'use client';

import { useState, useEffect } from 'react';
import { Building, Calendar, RefreshCw, CheckCircle2 } from 'lucide-react';
import { collection, query, getDocs, where, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { format, isToday, isTomorrow, parseISO, startOfToday } from 'date-fns';

interface Cleaner {
  id: string;
  name: string;
  phone: string;
}

interface Cleaning {
  id: string;
  propertyId: string;
  date: string;
  cleanerId: string;
  status: 'pending' | 'done';
  supplies: string;
}

interface CleaningTask {
  bookingId: string;
  cleaningId: string | null;
  propertyId: string;
  propertyName: string;
  guestName: string;
  checkOut: string;
  cleanerId: string;
  cleanerName: string;
  supplies: string;
  status: 'pending' | 'done';
}

export default function Dashboard() {
  const [stats, setStats] = useState({ properties: 0, reservations: 0, lastSync: '없음' });
  const [cleaningTasks, setCleaningTasks] = useState<CleaningTask[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const { user, profile } = useAuth();

  const fetchData = async () => {
    if (!user) return;
    try {
      const propsSnapshot = profile?.role === 'super_admin'
        ? await getDocs(collection(db, 'properties'))
        : await getDocs(query(collection(db, 'properties'), where('ownerId', '==', user.uid)));

      const propertiesMap = new Map<string, string>();
      let latestSync: Date | null = null;
      propsSnapshot.docs.forEach(d => {
        propertiesMap.set(d.id, d.data().name);
        if (d.data().lastSyncedAt) {
          const syncDate = d.data().lastSyncedAt.toDate();
          if (!latestSync || syncDate > latestSync) latestSync = syncDate;
        }
      });

      const propertyIds = Array.from(propertiesMap.keys());
      let reservationsCount = 0;
      const today = startOfToday();

      // Fetch relevant bookings (checkout today, tomorrow, or past pending)
      const checkoutBookings: { bookingId: string; propertyId: string; guestName: string; checkOut: string }[] = [];
      if (propertyIds.length > 0) {
        for (let i = 0; i < propertyIds.length; i += 10) {
          const snap = await getDocs(query(
            collection(db, 'bookings'),
            where('propertyId', 'in', propertyIds.slice(i, i + 10)),
            where('status', '==', 'confirmed')
          ));
          snap.docs.forEach(d => {
            reservationsCount++;
            const checkOutDate = parseISO(d.data().checkOut);
            if (isToday(checkOutDate) || isTomorrow(checkOutDate) || checkOutDate < today) {
              checkoutBookings.push({
                bookingId: d.id,
                propertyId: d.data().propertyId,
                guestName: d.data().name,
                checkOut: d.data().checkOut,
              });
            }
          });
        }
      }

      // Fetch cleaners
      const cleanersSnap = profile?.role === 'super_admin'
        ? await getDocs(collection(db, 'cleaners'))
        : await getDocs(query(collection(db, 'cleaners'), where('ownerId', '==', user.uid)));
      const cleanersList = cleanersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Cleaner));
      const cleanersMap = new Map(cleanersList.map(c => [c.id, c]));
      setCleaners(cleanersList);

      // Fetch cleanings for relevant properties
      const cleaningsByKey = new Map<string, Cleaning>();
      if (propertyIds.length > 0) {
        for (let i = 0; i < propertyIds.length; i += 10) {
          const snap = await getDocs(query(
            collection(db, 'cleanings'),
            where('propertyId', 'in', propertyIds.slice(i, i + 10))
          ));
          snap.docs.forEach(d => {
            const c = { id: d.id, ...d.data() } as Cleaning;
            cleaningsByKey.set(`${c.propertyId}_${c.date}`, c);
          });
        }
      }

      // Build tasks: join bookings + cleanings
      const tasks: CleaningTask[] = checkoutBookings
        .map(b => {
          const cleaning = cleaningsByKey.get(`${b.propertyId}_${b.checkOut}`);
          const cleanerName = cleaning?.cleanerId ? (cleanersMap.get(cleaning.cleanerId)?.name ?? '') : '';
          // Skip tasks that are 'done' and not today
          if (cleaning?.status === 'done' && !isToday(parseISO(b.checkOut))) return null;
          return {
            bookingId: b.bookingId,
            cleaningId: cleaning?.id ?? null,
            propertyId: b.propertyId,
            propertyName: propertiesMap.get(b.propertyId) ?? '알 수 없는 숙소',
            guestName: b.guestName,
            checkOut: b.checkOut,
            cleanerId: cleaning?.cleanerId ?? '',
            cleanerName,
            supplies: cleaning?.supplies ?? '',
            status: cleaning?.status ?? 'pending',
          };
        })
        .filter((t): t is CleaningTask => t !== null)
        .sort((a, b) => a.checkOut.localeCompare(b.checkOut));

      setStats({
        properties: propsSnapshot.size,
        reservations: reservationsCount,
        lastSync: latestSync ? format(latestSync, 'MM/dd HH:mm') : '없음',
      });
      setCleaningTasks(tasks);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [user]);

  const handleSync = async () => {
    if (!user) return;
    setIsSyncing(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const propsQuery = profile?.role === 'super_admin'
        ? collection(db, 'properties')
        : query(collection(db, 'properties'), where('ownerId', '==', user.uid));
      const propsSnapshot = await getDocs(propsQuery);
      await Promise.all(propsSnapshot.docs.map(propertyDoc =>
        updateDoc(doc(db, 'properties', propertyDoc.id), { lastSyncedAt: serverTimestamp() })
      ));
      await fetchData();
    } catch (error) {
      console.error('Sync failed:', error);
      alert('동기화 중 오류가 발생했습니다.');
    } finally {
      setIsSyncing(false);
    }
  };

  const updateCleaningField = async (task: CleaningTask, field: 'cleanerId' | 'supplies', value: string) => {
    // Optimistic update
    setCleaningTasks(prev => prev.map(t =>
      t.bookingId === task.bookingId
        ? {
            ...t,
            [field]: value,
            cleanerName: field === 'cleanerId'
              ? (cleaners.find(c => c.id === value)?.name ?? '')
              : t.cleanerName,
          }
        : t
    ));

    try {
      if (task.cleaningId) {
        await updateDoc(doc(db, 'cleanings', task.cleaningId), {
          [field]: value,
          updatedAt: new Date().toISOString(),
        });
      } else {
        // Create new cleaning record
        const newDoc = await addDoc(collection(db, 'cleanings'), {
          propertyId: task.propertyId,
          date: task.checkOut,
          cleanerId: field === 'cleanerId' ? value : task.cleanerId,
          status: 'pending',
          supplies: field === 'supplies' ? value : task.supplies,
          createdAt: new Date().toISOString(),
        });
        setCleaningTasks(prev => prev.map(t =>
          t.bookingId === task.bookingId ? { ...t, cleaningId: newDoc.id } : t
        ));
      }
    } catch (error) {
      console.error('Failed to update cleaning:', error);
      fetchData();
    }
  };

  const toggleStatus = async (task: CleaningTask) => {
    const newStatus: 'pending' | 'done' = task.status === 'done' ? 'pending' : 'done';
    setCleaningTasks(prev => prev.map(t =>
      t.bookingId === task.bookingId ? { ...t, status: newStatus } : t
    ));
    try {
      if (task.cleaningId) {
        await updateDoc(doc(db, 'cleanings', task.cleaningId), {
          status: newStatus,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const newDoc = await addDoc(collection(db, 'cleanings'), {
          propertyId: task.propertyId,
          date: task.checkOut,
          cleanerId: task.cleanerId,
          status: newStatus,
          supplies: task.supplies,
          createdAt: new Date().toISOString(),
        });
        setCleaningTasks(prev => prev.map(t =>
          t.bookingId === task.bookingId ? { ...t, cleaningId: newDoc.id } : t
        ));
      }
    } catch (error) {
      console.error('Failed to toggle status:', error);
      fetchData();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-12">
      <header className="border-b border-white/10 pb-8 flex flex-col sm:flex-row gap-4 sm:justify-between sm:items-end">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-white/50 mb-4">개요</p>
          <h1 className="text-3xl md:text-4xl font-light tracking-tight text-white">대시보드</h1>
          <p className="text-white/50 mt-4 text-sm font-light tracking-wide">void anchae 호스트 대시보드에 오신 것을 환영합니다.</p>
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center justify-center gap-2 bg-white text-black px-6 py-3 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
          {isSyncing ? '동기화 중...' : 'iCal 전체 동기화'}
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-[#111] p-8 border border-white/10 flex flex-col gap-6 group hover:border-white/30 transition-colors">
          <div className="text-white/50 group-hover:text-white transition-colors">
            <Building size={24} strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-[10px] tracking-widest text-white/50 mb-2">등록된 숙소</p>
            <p className="text-4xl font-light text-white">{stats.properties}</p>
          </div>
        </div>
        <div className="bg-[#111] p-8 border border-white/10 flex flex-col gap-6 group hover:border-white/30 transition-colors">
          <div className="text-white/50 group-hover:text-white transition-colors">
            <Calendar size={24} strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-[10px] tracking-widest text-white/50 mb-2">활성 예약</p>
            <p className="text-4xl font-light text-white">{stats.reservations}</p>
          </div>
        </div>
        <div className="bg-[#111] p-8 border border-white/10 flex flex-col gap-6 group hover:border-white/30 transition-colors">
          <div className="text-white/50 group-hover:text-white transition-colors">
            <RefreshCw size={24} strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-[10px] tracking-widest text-white/50 mb-2">최근 동기화</p>
            <p className="text-xl font-light text-white mt-3">{stats.lastSync}</p>
          </div>
        </div>
      </div>

      <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden">
        <div className="p-8 border-b border-white/10">
          <h2 className="text-lg font-light tracking-wide text-white mb-1">청소 대시보드</h2>
          <p className="text-xs text-white/50">오늘과 내일 체크아웃 숙소의 청소 일정을 관리하세요.</p>
        </div>

        <div className="p-0">
          {cleaningTasks.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center text-white/40">
              <CheckCircle2 size={32} className="mb-4 opacity-50" />
              <p className="text-sm">현재 예정된 청소 일정이 없습니다.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {cleaningTasks.map(task => {
                const checkoutDate = parseISO(task.checkOut);
                const isTodayCheckout = isToday(checkoutDate);
                const isPast = checkoutDate < startOfToday();
                const isDone = task.status === 'done';

                return (
                  <div key={task.bookingId} className={`p-6 flex flex-col lg:flex-row gap-6 items-start lg:items-center transition-colors ${isDone ? 'bg-white/5' : 'hover:bg-white/[0.02]'}`}>

                    <div className="flex items-center gap-4 w-full lg:w-1/3">
                      <button
                        onClick={() => toggleStatus(task)}
                        className={`flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${
                          isDone
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-500'
                            : 'border-white/20 text-transparent hover:border-white/50'
                        }`}
                      >
                        <CheckCircle2 size={16} className={isDone ? 'opacity-100' : 'opacity-0'} />
                      </button>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-medium ${
                            isPast ? 'bg-red-500/20 text-red-400' :
                            isTodayCheckout ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'
                          }`}>
                            {isPast ? '지연됨' : isTodayCheckout ? '오늘 체크아웃' : '내일 체크아웃'}
                          </span>
                          <span className="text-xs text-white/50">{task.checkOut}</span>
                        </div>
                        <h3 className={`text-base font-medium ${isDone ? 'text-white/50 line-through' : 'text-white'}`}>
                          {task.propertyName}
                        </h3>
                        <p className="text-xs text-white/40 mt-1">게스트: {task.guestName}</p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-2/3">
                      <div className="flex-1">
                        <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">청소 담당자</label>
                        <select
                          value={task.cleanerId}
                          onChange={e => updateCleaningField(task, 'cleanerId', e.target.value)}
                          disabled={isDone}
                          className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors appearance-none disabled:opacity-50"
                        >
                          <option value="">담당자 선택</option>
                          {cleaners.map(c => (
                            <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">필요 재고 및 특이사항</label>
                        <input
                          type="text"
                          value={task.supplies}
                          onChange={e => updateCleaningField(task, 'supplies', e.target.value)}
                          onBlur={e => updateCleaningField(task, 'supplies', e.target.value)}
                          placeholder="예: 수건 4장, 샴푸 보충"
                          disabled={isDone}
                          className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors disabled:opacity-50"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
