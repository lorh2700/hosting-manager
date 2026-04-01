'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import koLocale from '@fullcalendar/core/locales/ko';
import { X, Save, Trash2 } from 'lucide-react';

const PROPERTY_COLORS = [
  '#6366f1',
  '#f59e0b',
  '#10b981',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#f97316',
];

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getChannelLabel(channelId: string, source: string | undefined, channelMap: Record<string, string>) {
  if (channelId === 'direct') return '직접예약';
  if (channelId === 'beds24') {
    const s = (source || '').toLowerCase();
    if (s.includes('airbnb')) return 'Airbnb';
    if (s.includes('booking')) return 'Booking.com';
    if (s.includes('agoda')) return 'Agoda';
    if (s.includes('stayfolio')) return 'Stayfolio';
    if (s.includes('expedia')) return 'Expedia';
    if (s.includes('direct') || s === '') return '직접예약';
    return 'Beds24';
  }
  return channelMap[channelId] || channelId;
}

interface Property {
  id: string;
  name: string;
  color: string;
}

interface RawEvent {
  id: string;
  propertyId: string;
  channelId: string;
  source?: string;
  title: string;
  start: string;
  end: string;
  type: 'reservation' | 'block';
  description?: string;
}

interface Cleaning {
  id: string;
  propertyId: string;
  propertyName: string;
  date: string;
  cleaner: string;
  month: string;
  supplies?: string;
}

interface Cleaner {
  id: string;
  name: string;
  phone: string;
}

interface SelectedEvent {
  title: string;
  start: string;
  end: string;
  propertyId: string;
  propertyName: string;
  propertyColor: string;
  channelLabel: string;
  description?: string;
  // cleaning
  cleaningId: string | null;
  cleaner: string | null;
  supplies: string | null;
}

export default function UnifiedCalendarPage() {
  const { user } = useAuth();
  const calendarRef = useRef<FullCalendar>(null);

  const [properties, setProperties] = useState<Property[]>([]);
  const [channelMap, setChannelMap] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [cleanings, setCleanings] = useState<Cleaning[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProps, setActiveProps] = useState<Set<string>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null);

  // Modal form state
  const [selectedCleaner, setSelectedCleaner] = useState('');
  const [selectedSupplies, setSelectedSupplies] = useState('');
  const [cleanerSaving, setCleanerSaving] = useState(false);

  useEffect(() => {
    if (!user) return;

    const fetchAll = async () => {
      try {
        const propsSnap = await getDocs(
          query(collection(db, 'properties'), where('ownerId', '==', user.uid))
        );
        const props: Property[] = propsSnap.docs.map((d, i) => ({
          id: d.id,
          name: d.data().name,
          color: PROPERTY_COLORS[i % PROPERTY_COLORS.length],
        }));
        setProperties(props);
        setActiveProps(new Set(props.map(p => p.id)));

        if (props.length === 0) return;
        const propIds = props.map(p => p.id);

        const cMap: Record<string, string> = {};
        for (let i = 0; i < propIds.length; i += 10) {
          const snap = await getDocs(
            query(collection(db, 'channels'), where('propertyId', 'in', propIds.slice(i, i + 10)))
          );
          snap.docs.forEach(d => { cMap[d.id] = d.data().name; });
        }
        setChannelMap(cMap);

        const allEvents: RawEvent[] = [];
        for (let i = 0; i < propIds.length; i += 10) {
          const snap = await getDocs(
            query(collection(db, 'events'), where('propertyId', 'in', propIds.slice(i, i + 10)))
          );
          snap.docs.forEach(d => allEvents.push({ id: d.id, ...d.data() } as RawEvent));
        }

        for (let i = 0; i < propIds.length; i += 10) {
          const snap = await getDocs(
            query(
              collection(db, 'bookings'),
              where('propertyId', 'in', propIds.slice(i, i + 10)),
              where('status', '==', 'confirmed')
            )
          );
          snap.docs.forEach(d => {
            const bk = d.data();
            allEvents.push({
              id: d.id,
              propertyId: bk.propertyId,
              channelId: 'direct',
              source: 'direct',
              title: `${bk.name} 예약`,
              start: bk.checkIn,
              end: bk.checkOut,
              type: 'reservation',
              description: `게스트: ${bk.name}\n연락처: ${bk.email}\n인원: ${bk.guests}명`,
            });
          });
        }
        setEvents(allEvents);

        const allCleanings: Cleaning[] = [];
        for (let i = 0; i < propIds.length; i += 10) {
          const snap = await getDocs(
            query(collection(db, 'cleanings'), where('propertyId', 'in', propIds.slice(i, i + 10)))
          );
          snap.docs.forEach(d => allCleanings.push({ id: d.id, ...d.data() } as Cleaning));
        }
        setCleanings(allCleanings);

        // Load registered cleaners
        const cleanersSnap = await getDocs(
          query(collection(db, 'cleaners'), where('ownerId', '==', user.uid))
        );
        setCleaners(cleanersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Cleaner)));
      } catch (err) {
        console.error('Failed to load calendar data', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [user]);

  const calendarEvents = useMemo(() => {
    return events
      .filter(e => activeProps.has(e.propertyId) && e.type !== 'block')
      .map(e => {
        const prop = properties.find(p => p.id === e.propertyId);
        const color = prop?.color ?? '#6366f1';
        const checkoutDate = e.end.substring(0, 10);
        const cleaning = cleanings.find(
          c => c.propertyId === e.propertyId && c.date === checkoutDate
        );
        return {
          id: `ev-${e.id}`,
          title: e.title,
          start: e.start,
          end: e.end,
          backgroundColor: color,
          borderColor: color,
          extendedProps: {
            kind: 'booking',
            propertyId: e.propertyId,
            propertyName: prop?.name ?? '',
            propertyColor: color,
            channelLabel: getChannelLabel(e.channelId, e.source, channelMap),
            description: e.description,
            start: e.start,
            end: e.end,
            cleaningId: cleaning?.id ?? null,
            cleaner: cleaning?.cleaner ?? null,
            supplies: cleaning?.supplies ?? null,
          },
        };
      });
  }, [events, cleanings, activeProps, properties, channelMap]);

  const toggleProp = (propId: string) => {
    setActiveProps(prev => {
      const next = new Set(prev);
      if (next.has(propId)) next.delete(propId);
      else next.add(propId);
      return next;
    });
  };

  const openModal = (ep: Record<string, string | null>) => {
    const ev: SelectedEvent = {
      title: ep.title as string,
      start: ep.start as string,
      end: ep.end as string,
      propertyId: ep.propertyId as string,
      propertyName: ep.propertyName as string,
      propertyColor: ep.propertyColor as string,
      channelLabel: ep.channelLabel as string,
      description: ep.description as string | undefined,
      cleaningId: ep.cleaningId as string | null,
      cleaner: ep.cleaner as string | null,
      supplies: ep.supplies as string | null,
    };
    setSelectedEvent(ev);
    setSelectedCleaner(ep.cleaner ?? '');
    setSelectedSupplies(ep.supplies ?? '');
  };

  const handleSaveCleaner = async () => {
    if (!selectedEvent || !user) return;
    setCleanerSaving(true);
    const checkoutDate = selectedEvent.end.substring(0, 10);
    const month = checkoutDate.substring(0, 7);
    const propName = selectedEvent.propertyName;

    try {
      if (selectedEvent.cleaningId) {
        // Update existing
        await updateDoc(doc(db, 'cleanings', selectedEvent.cleaningId), {
          cleaner: selectedCleaner,
          supplies: selectedSupplies,
        });
        setCleanings(prev =>
          prev.map(c => c.id === selectedEvent.cleaningId ? { ...c, cleaner: selectedCleaner, supplies: selectedSupplies } : c)
        );
      } else {
        // Create new
        const newDoc = await addDoc(collection(db, 'cleanings'), {
          propertyId: selectedEvent.propertyId,
          propertyName: propName,
          date: checkoutDate,
          cleaner: selectedCleaner,
          supplies: selectedSupplies,
          month,
          createdAt: new Date().toISOString(),
        });
        const newCleaning: Cleaning = {
          id: newDoc.id,
          propertyId: selectedEvent.propertyId,
          propertyName: propName,
          date: checkoutDate,
          cleaner: selectedCleaner,
          supplies: selectedSupplies,
          month,
        };
        setCleanings(prev => [...prev, newCleaning]);
        setSelectedEvent(prev => prev ? { ...prev, cleaningId: newDoc.id, cleaner: selectedCleaner, supplies: selectedSupplies } : null);
      }
      setSelectedEvent(null);
    } catch (err) {
      console.error(err);
      alert('저장에 실패했습니다.');
    } finally {
      setCleanerSaving(false);
    }
  };

  const handleDeleteCleaner = async () => {
    if (!selectedEvent?.cleaningId) return;
    if (!confirm('청소 담당자 배정을 삭제하시겠습니까?')) return;
    setCleanerSaving(true);
    try {
      await deleteDoc(doc(db, 'cleanings', selectedEvent.cleaningId));
      setCleanings(prev => prev.filter(c => c.id !== selectedEvent.cleaningId));
      setSelectedEvent(prev => prev ? { ...prev, cleaningId: null, cleaner: null } : null);
      setSelectedCleaner('');
    } catch (err) {
      console.error(err);
      alert('삭제에 실패했습니다.');
    } finally {
      setCleanerSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <header className="pb-6 border-b border-white/10">
        <h1 className="text-3xl font-light tracking-tight text-white">통합 캘린더</h1>
        <p className="text-white/40 mt-1 text-xs tracking-widest font-light">모든 숙소의 투숙 및 청소 일정</p>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-[10px] text-white/30 tracking-widest font-medium mr-1">숙소</span>
        {properties.map(p => {
          const on = activeProps.has(p.id);
          return (
            <button
              key={p.id}
              onClick={() => toggleProp(p.id)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] font-medium tracking-wide transition-all"
              style={{
                borderColor: on ? p.color : 'rgba(255,255,255,0.1)',
                backgroundColor: on ? hexToRgba(p.color, 0.13) : 'transparent',
                color: on ? '#fff' : 'rgba(255,255,255,0.3)',
              }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: on ? p.color : 'rgba(255,255,255,0.15)' }} />
              {p.name}
            </button>
          );
        })}
      </div>

      {/* FullCalendar */}
      <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden p-4 unified-cal">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale={koLocale}
          events={calendarEvents}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,dayGridWeek',
          }}
          height="auto"
          eventClick={(info) => {
            const ep = info.event.extendedProps;
            openModal({
              title: info.event.title,
              ...ep,
            } as Record<string, string | null>);
          }}
          eventContent={(arg) => {
            const ep = arg.event.extendedProps;
            return (
              <div className="flex items-center gap-1 px-1.5 py-0.5 w-full overflow-hidden">
                <span className="text-[10px] font-medium text-white leading-tight truncate flex-1 min-w-0">
                  {ep.propertyName} · {arg.event.title}
                </span>
                {ep.cleaner && arg.isEnd && (
                  <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full leading-tight"
                    style={{ backgroundColor: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.9)' }}>
                    🧹{ep.cleaner}
                  </span>
                )}
              </div>
            );
          }}
          dayMaxEvents={5}
          moreLinkContent={(args) => `+${args.num}건`}
        />
      </div>

      {/* Modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-[#161616] border border-white/10 rounded-2xl w-full max-w-sm mx-4 p-6 space-y-5"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: selectedEvent.propertyColor }} />
                <div>
                  <p className="text-[10px] text-white/40 tracking-widest font-medium">{selectedEvent.propertyName}</p>
                  <h3 className="text-white font-light text-lg leading-snug mt-0.5">{selectedEvent.title}</h3>
                </div>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="text-white/30 hover:text-white transition-colors shrink-0 mt-1">
                <X size={16} />
              </button>
            </div>

            {/* Info */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-[10px] tracking-widest text-white/40">채널</span>
                <span className="text-white/80 text-[11px]">{selectedEvent.channelLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] tracking-widest text-white/40">체크인</span>
                <span className="text-white/80 text-[11px] font-mono">{selectedEvent.start?.substring(0, 10)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] tracking-widest text-white/40">체크아웃</span>
                <span className="text-white/80 text-[11px] font-mono">{selectedEvent.end?.substring(0, 10)}</span>
              </div>
              {selectedEvent.description && (
                <div className="pt-2 border-t border-white/8">
                  <p className="text-[10px] tracking-widest text-white/30 mb-1.5">메모</p>
                  <p className="text-white/60 text-[11px] font-light whitespace-pre-line leading-relaxed">{selectedEvent.description}</p>
                </div>
              )}
            </div>

            {/* Cleaner CRUD */}
            <div className="border-t border-white/10 pt-5 space-y-3">
              <p className="text-[10px] tracking-widest text-white/40 font-medium">청소 담당자</p>

              <select
                value={selectedCleaner}
                onChange={e => setSelectedCleaner(e.target.value)}
                className="w-full bg-black/60 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors appearance-none"
              >
                <option value="">담당자 없음</option>
                {cleaners.map(c => (
                  <option key={c.id} value={c.name}>
                    {c.name}{c.phone ? ` (${c.phone})` : ''}
                  </option>
                ))}
                {selectedCleaner && !cleaners.some(c => c.name === selectedCleaner) && (
                  <option value={selectedCleaner}>{selectedCleaner}</option>
                )}
              </select>

              <div>
                <p className="text-[10px] tracking-widest text-white/40 font-medium mb-2">필요 비품</p>
                <textarea
                  value={selectedSupplies}
                  onChange={e => setSelectedSupplies(e.target.value)}
                  placeholder="예: 수건 4장, 샴푸 보충, 커피 캡슐 2개"
                  rows={3}
                  className="w-full bg-black/60 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors resize-none placeholder:text-white/20"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSaveCleaner}
                  disabled={cleanerSaving || (selectedCleaner === (selectedEvent.cleaner ?? '') && selectedSupplies === (selectedEvent.supplies ?? ''))}
                  className="flex-1 flex items-center justify-center gap-2 bg-white text-black py-2.5 text-[11px] tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Save size={13} />
                  {cleanerSaving ? '저장 중...' : '저장'}
                </button>

                {selectedEvent.cleaningId && (
                  <button
                    onClick={handleDeleteCleaner}
                    disabled={cleanerSaving}
                    className="px-4 py-2.5 border border-white/10 text-white/40 hover:text-red-400 hover:border-red-400/30 transition-colors disabled:opacity-40"
                    title="배정 삭제"
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                )}
              </div>

              {cleaners.length === 0 && (
                <p className="text-[10px] text-white/30 text-center">
                  등록된 담당자가 없습니다.{' '}
                  <a href="/admin/cleaners" className="text-white/60 underline hover:text-white transition-colors">
                    담당자 관리
                  </a>
                  에서 먼저 추가하세요.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .unified-cal .fc-toolbar-title { font-size: 1.1rem; font-weight: 300; color: white; letter-spacing: 0.05em; }
        .unified-cal .fc-button { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.1) !important; color: rgba(255,255,255,0.6) !important; font-size: 11px !important; letter-spacing: 0.1em !important; font-weight: 600 !important; padding: 6px 14px !important; border-radius: 8px !important; text-transform: uppercase; }
        .unified-cal .fc-button:hover { background: rgba(255,255,255,0.12) !important; color: white !important; }
        .unified-cal .fc-button-active { background: white !important; color: black !important; border-color: white !important; }
        .unified-cal .fc-col-header-cell-cushion { color: rgba(255,255,255,0.75) !important; font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 600; padding: 10px 0; }
        .unified-cal .fc-col-header-cell:nth-child(1) .fc-col-header-cell-cushion { color: rgba(255,100,100,0.85) !important; }
        .unified-cal .fc-col-header-cell:nth-child(7) .fc-col-header-cell-cushion { color: rgba(100,160,255,0.85) !important; }
        .unified-cal .fc-daygrid-day-number { color: rgba(255,255,255,0.5) !important; font-size: 12px; font-weight: 300; padding: 6px 8px; }
        .unified-cal .fc-day-today .fc-daygrid-day-number { color: white !important; font-weight: 600; }
        .unified-cal .fc-day-today { background: rgba(255,255,255,0.03) !important; }
        .unified-cal .fc-daygrid-day-frame { min-height: 90px; }
        .unified-cal td, .unified-cal th { border-color: rgba(255,255,255,0.06) !important; }
        .unified-cal .fc-scrollgrid { border-color: rgba(255,255,255,0.06) !important; }
        .unified-cal .fc-more-link { color: rgba(255,255,255,0.4) !important; font-size: 10px; }
        .unified-cal .fc-event { border-radius: 6px !important; cursor: pointer; }
        .unified-cal .fc-popover { background: #1a1a1a !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 12px !important; }
        .unified-cal .fc-popover-header { background: rgba(255,255,255,0.05) !important; color: white !important; border-radius: 12px 12px 0 0 !important; }
        .unified-cal .fc-popover-body { background: #1a1a1a !important; }
      `}</style>
    </div>
  );
}
