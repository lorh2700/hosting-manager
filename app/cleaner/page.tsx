'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { format, parseISO, isToday, isTomorrow, isPast } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CheckCircle2, Clock, CalendarDays } from 'lucide-react';

interface CleaningTask {
  cleaningId: string;
  propertyName: string;
  date: string;
  guestName: string;
  supplies: string;
  status: 'pending' | 'done';
}

export default function CleanerPage() {
  const { user, profile } = useAuth();
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !profile) return;

    const load = async () => {
      try {
        // Fetch properties this cleaner has access to
        let propertyIds: string[] = [];
        if (profile.role === 'super_admin') {
          const snap = await getDocs(collection(db, 'properties'));
          propertyIds = snap.docs.map(d => d.id);
        } else {
          propertyIds = profile.propertyIds;
        }

        if (propertyIds.length === 0) {
          setLoading(false);
          return;
        }

        // Build property name map
        const propNames: Record<string, string> = {};
        await Promise.all(propertyIds.map(async pid => {
          const snap = await getDoc(doc(db, 'properties', pid));
          if (snap.exists()) propNames[pid] = snap.data().name;
        }));

        // Fetch cleanings assigned to this cleaner
        const cleaningsQuery = profile.role === 'super_admin'
          ? query(collection(db, 'cleanings'), where('propertyId', 'in', propertyIds.slice(0, 10)))
          : query(collection(db, 'cleanings'), where('cleanerId', '==', user.uid), where('propertyId', 'in', propertyIds.slice(0, 10)));

        const cleaningsSnap = await getDocs(cleaningsQuery);

        // Fetch checkout bookings to get guest names
        const bookingsSnap = await getDocs(query(
          collection(db, 'bookings'),
          where('propertyId', 'in', propertyIds.slice(0, 10)),
          where('status', '==', 'confirmed')
        ));
        const guestByKey: Record<string, string> = {};
        bookingsSnap.docs.forEach(d => {
          const data = d.data();
          guestByKey[`${data.propertyId}_${data.checkOut}`] = data.name;
        });

        const result: CleaningTask[] = cleaningsSnap.docs.map(d => {
          const data = d.data();
          return {
            cleaningId: d.id,
            propertyName: propNames[data.propertyId] ?? '알 수 없는 숙소',
            date: data.date,
            guestName: guestByKey[`${data.propertyId}_${data.date}`] ?? '',
            supplies: data.supplies ?? '',
            status: data.status ?? 'pending',
          };
        }).sort((a, b) => a.date.localeCompare(b.date));

        setTasks(result);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user, profile]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  const getDateLabel = (dateStr: string) => {
    const d = parseISO(dateStr);
    if (isToday(d)) return '오늘';
    if (isTomorrow(d)) return '내일';
    return format(d, 'M월 d일 (EEE)', { locale: ko });
  };

  const upcoming = tasks.filter(t => !isPast(parseISO(t.date)) || isToday(parseISO(t.date)));
  const past = tasks.filter(t => isPast(parseISO(t.date)) && !isToday(parseISO(t.date)));

  const TaskCard = ({ task }: { task: CleaningTask }) => (
    <div className={`border p-5 transition-colors ${
      task.status === 'done' ? 'border-white/5 bg-[#0a0a0a]' : 'border-white/10 bg-[#111]'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {task.status === 'done'
              ? <CheckCircle2 size={14} className="text-green-400 shrink-0" />
              : <Clock size={14} className="text-white/40 shrink-0" />
            }
            <span className={`text-[10px] uppercase tracking-widest font-semibold ${
              task.status === 'done' ? 'text-green-400' : 'text-white/50'
            }`}>
              {task.status === 'done' ? '완료' : '청소 예정'}
            </span>
          </div>
          <p className="text-white font-medium text-sm">{task.propertyName}</p>
          {task.guestName && (
            <p className="text-white/40 text-xs mt-1">{task.guestName} 체크아웃</p>
          )}
          {task.supplies && (
            <p className="text-white/50 text-xs mt-2 leading-relaxed">{task.supplies}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-white text-sm font-medium">{getDateLabel(task.date)}</p>
          <p className="text-white/30 text-[10px] mt-0.5">{task.date}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-10">
      <header className="border-b border-white/10 pb-6 mt-4">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-2">청소 담당자</p>
        <h1 className="text-2xl font-light tracking-tight text-white">내 청소 일정</h1>
      </header>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center text-white/40 py-16">
          <CalendarDays size={32} className="mb-4 opacity-50" />
          <p className="text-sm">배정된 청소 일정이 없습니다.</p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-[10px] uppercase tracking-widest text-white/40">예정된 일정 ({upcoming.length})</h2>
              {upcoming.map(t => <TaskCard key={t.cleaningId} task={t} />)}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-[10px] uppercase tracking-widest text-white/40">지난 일정 ({past.length})</h2>
              {past.map(t => <TaskCard key={t.cleaningId} task={t} />)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
