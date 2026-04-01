'use client';

import { useState, useEffect } from 'react';
import { Building, Calendar, RefreshCw, CheckCircle2 } from 'lucide-react';
import { collection, query, getDocs, where, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { format, isToday, isTomorrow, parseISO, startOfToday } from 'date-fns';


interface Cleaner {
  id: string;
  name: string;
  phone: string;
}

interface CleaningTask {
  id: string;
  propertyId: string;
  propertyName: string;
  guestName: string;
  checkOut: string;
  cleanerName: string;
  requiredInventory: string;
  cleaningStatus: 'pending' | 'completed';
}

export default function Dashboard() {
  const [stats, setStats] = useState({
    properties: 0,
    reservations: 0,
    lastSync: '없음',
  });
  const [cleaningTasks, setCleaningTasks] = useState<CleaningTask[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  const fetchData = async () => {
    if (!user) return;
    try {
      const propsQuery = query(collection(db, 'properties'), where('ownerId', '==', user.uid));
      const propsSnapshot = await getDocs(propsQuery);
      const propertiesCount = propsSnapshot.size;
      
      const propertiesMap = new Map();
      let latestSync: Date | null = null;

      propsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        propertiesMap.set(doc.id, data.name);
        if (data.lastSyncedAt) {
          const syncDate = data.lastSyncedAt.toDate();
          if (!latestSync || syncDate > latestSync) {
            latestSync = syncDate;
          }
        }
      });

      let reservationsCount = 0;
      const tasks: CleaningTask[] = [];
      
      if (propertiesCount > 0) {
        const propertyIds = Array.from(propertiesMap.keys());
        // Fetch bookings for the first 10 properties (Firestore 'in' limit)
        const bookingsQuery = query(collection(db, 'bookings'), where('propertyId', 'in', propertyIds.slice(0, 10)));
        const bookingsSnapshot = await getDocs(bookingsQuery);
        
        reservationsCount = bookingsSnapshot.docs.filter(d => d.data().status === 'confirmed').length;

        // Filter for cleaning tasks (checkouts today or tomorrow)
        const today = startOfToday();
        bookingsSnapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data.status === 'confirmed') {
            const checkOutDate = parseISO(data.checkOut);
            // Show tasks for today and tomorrow
            if (isToday(checkOutDate) || isTomorrow(checkOutDate) || checkOutDate < today) {
              // Only show if not completed or if completed today
              if (data.cleaningStatus !== 'completed' || isToday(checkOutDate)) {
                tasks.push({
                  id: doc.id,
                  propertyId: data.propertyId,
                  propertyName: propertiesMap.get(data.propertyId) || '알 수 없는 숙소',
                  guestName: data.name,
                  checkOut: data.checkOut,
                  cleanerName: data.cleanerName || '',
                  requiredInventory: data.requiredInventory || '',
                  cleaningStatus: data.cleaningStatus || 'pending',
                });
              }
            }
          }
        });
      }

      // Sort tasks by checkout date
      tasks.sort((a, b) => a.checkOut.localeCompare(b.checkOut));

      setStats({
        properties: propertiesCount,
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

  useEffect(() => {
    fetchData();
    if (user) {
      getDocs(query(collection(db, 'cleaners'), where('ownerId', '==', user.uid)))
        .then(snap => setCleaners(snap.docs.map(d => ({ id: d.id, ...d.data() } as Cleaner))));
    }
  }, [user]);

  const handleSync = async () => {
    if (!user) return;
    setIsSyncing(true);
    try {
      // Simulate iCal fetching delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const propsQuery = query(collection(db, 'properties'), where('ownerId', '==', user.uid));
      const propsSnapshot = await getDocs(propsQuery);
      
      // Update lastSyncedAt for all properties
      const updatePromises = propsSnapshot.docs.map(propertyDoc => 
        updateDoc(doc(db, 'properties', propertyDoc.id), {
          lastSyncedAt: serverTimestamp()
        })
      );
      
      await Promise.all(updatePromises);
      await fetchData(); // Refresh data to show new sync time
      
    } catch (error) {
      console.error('Sync failed:', error);
      alert('동기화 중 오류가 발생했습니다.');
    } finally {
      setIsSyncing(false);
    }
  };

  const updateCleaningTask = async (taskId: string, field: string, value: string) => {
    try {
      // Optimistic UI update
      setCleaningTasks(prev => prev.map(task => 
        task.id === taskId ? { ...task, [field]: value } : task
      ));
      
      // Update Firestore
      await updateDoc(doc(db, 'bookings', taskId), {
        [field]: value
      });
    } catch (error) {
      console.error('Failed to update task:', error);
      // Revert on error (simple reload for MVP)
      fetchData();
    }
  };

  const toggleCleaningStatus = async (taskId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    await updateCleaningTask(taskId, 'cleaningStatus', newStatus);
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
      <header className="border-b border-white/10 pb-8 flex justify-between items-end">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-white/50 mb-4">개요</p>
          <h1 className="text-4xl font-light tracking-tight text-white">대시보드</h1>
          <p className="text-white/50 mt-4 text-sm font-light tracking-wide">void anchae 호스트 대시보드에 오신 것을 환영합니다.</p>
        </div>
        <button 
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-2 bg-white text-black px-6 py-3 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50"
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

      {/* Cleaning & Maintenance Dashboard */}
      <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden">
        <div className="p-8 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-light tracking-wide text-white mb-1">청소 및 유지보수 대시보드</h2>
            <p className="text-xs text-white/50">오늘과 내일 체크아웃하는 숙소의 청소 일정을 관리하세요.</p>
          </div>
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
                
                return (
                  <div key={task.id} className={`p-6 flex flex-col lg:flex-row gap-6 items-start lg:items-center transition-colors ${task.cleaningStatus === 'completed' ? 'bg-white/5' : 'hover:bg-white/[0.02]'}`}>
                    
                    {/* Status & Info */}
                    <div className="flex items-center gap-4 w-full lg:w-1/3">
                      <button 
                        onClick={() => toggleCleaningStatus(task.id, task.cleaningStatus)}
                        className={`flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${
                          task.cleaningStatus === 'completed' 
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-500' 
                            : 'border-white/20 text-transparent hover:border-white/50'
                        }`}
                      >
                        <CheckCircle2 size={16} className={task.cleaningStatus === 'completed' ? 'opacity-100' : 'opacity-0'} />
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
                        <h3 className={`text-base font-medium ${task.cleaningStatus === 'completed' ? 'text-white/50 line-through' : 'text-white'}`}>
                          {task.propertyName}
                        </h3>
                        <p className="text-xs text-white/40 mt-1">게스트: {task.guestName}</p>
                      </div>
                    </div>

                    {/* Inputs */}
                    <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-2/3">
                      <div className="flex-1">
                        <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">청소 담당자</label>
                        <select
                          value={task.cleanerName}
                          onChange={(e) => updateCleaningTask(task.id, 'cleanerName', e.target.value)}
                          disabled={task.cleaningStatus === 'completed'}
                          className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors appearance-none disabled:opacity-50"
                        >
                          <option value="">담당자 선택</option>
                          {cleaners.map(c => (
                            <option key={c.id} value={c.name}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>
                          ))}
                          {task.cleanerName && !cleaners.some(c => c.name === task.cleanerName) && (
                            <option value={task.cleanerName}>{task.cleanerName}</option>
                          )}
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">필요 재고 및 특이사항</label>
                        <input 
                          type="text" 
                          value={task.requiredInventory}
                          onChange={(e) => updateCleaningTask(task.id, 'requiredInventory', e.target.value)}
                          placeholder="예: 수건 4장, 샴푸 보충"
                          className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
                          disabled={task.cleaningStatus === 'completed'}
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
