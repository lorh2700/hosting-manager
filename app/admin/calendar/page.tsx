'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { ChevronLeft, ChevronRight, X, Save, Trash2 } from 'lucide-react';
import { isAdminEmail } from '@/lib/adminConfig';

const PROPERTY_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316',
];

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
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
    return '직접예약';
  }
  return channelMap[channelId] || channelId;
}

interface Property { id: string; name: string; color: string; }
interface RawEvent { id: string; propertyId: string; channelId: string; source?: string; title: string; start: string; end: string; type: 'reservation' | 'block'; description?: string; }
interface Cleaning { id: string; propertyId: string; propertyName: string; date: string; cleaner: string; month: string; supplies?: string; }
interface Cleaner { id: string; name: string; phone: string; }
interface SelectedEvent {
  title: string; start: string; end: string;
  propertyId: string; propertyName: string; propertyColor: string;
  channelLabel: string; description?: string;
  cleaningId: string | null; cleaner: string | null; supplies: string | null;
}

interface ProcessedEvent {
  id: string; propertyId: string; color: string; propName: string;
  start: string;    // display start (inclusive, YYYY-MM-DD)
  end: string;      // display end (exclusive, YYYY-MM-DD) — extended +1 if no back-to-back
  rawEnd: string;   // original checkout date for modal/cleaning
  title: string; channelId: string; source?: string; description?: string;
  cleaningId: string | null; cleaner: string | null; supplies: string | null;
}

export default function UnifiedCalendarPage() {
  const { user } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [channelMap, setChannelMap] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [cleanings, setCleanings] = useState<Cleaning[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProps, setActiveProps] = useState<Set<string>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null);
  const [selectedCleaner, setSelectedCleaner] = useState('');
  const [selectedSupplies, setSelectedSupplies] = useState('');
  const [cleanerSaving, setCleanerSaving] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());

  useEffect(() => {
    if (!user) return;
    const fetchAll = async () => {
      try {
        const propsSnap = isAdminEmail(user.email)
          ? await getDocs(collection(db, 'properties'))
          : await getDocs(query(collection(db, 'properties'), where('ownerId', '==', user.uid)));
        const props: Property[] = propsSnap.docs.map((d, i) => ({
          id: d.id, name: d.data().name, color: PROPERTY_COLORS[i % PROPERTY_COLORS.length],
        }));
        setProperties(props);
        setActiveProps(new Set(props.map(p => p.id)));
        if (props.length === 0) return;
        const propIds = props.map(p => p.id);

        // Build channel map: channelName → channelName (doc ID is the name)
        const cMap: Record<string, string> = {};
        for (const propId of propIds) {
          const snap = await getDocs(collection(db, 'properties', propId, 'channels'));
          snap.docs.forEach(d => { cMap[d.id] = d.id; });
        }
        setChannelMap(cMap);

        const allEvents: RawEvent[] = [];
        for (let i = 0; i < propIds.length; i += 10) {
          const snap = await getDocs(query(collection(db, 'events'), where('propertyId', 'in', propIds.slice(i, i + 10))));
          snap.docs.forEach(d => allEvents.push({ id: d.id, ...d.data() } as RawEvent));
        }
        for (let i = 0; i < propIds.length; i += 10) {
          const snap = await getDocs(query(
            collection(db, 'bookings'),
            where('propertyId', 'in', propIds.slice(i, i + 10)),
            where('status', '==', 'confirmed')
          ));
          snap.docs.forEach(d => {
            const bk = d.data();
            allEvents.push({ id: d.id, propertyId: bk.propertyId, channelId: 'direct', source: 'direct', title: `${bk.name} 예약`, start: bk.checkIn, end: bk.checkOut, type: 'reservation', description: `게스트: ${bk.name}\n연락처: ${bk.email}\n인원: ${bk.guests}명` });
          });
        }
        setEvents(allEvents);

        const allCleanings: Cleaning[] = [];
        for (let i = 0; i < propIds.length; i += 10) {
          const snap = await getDocs(query(collection(db, 'cleanings'), where('propertyId', 'in', propIds.slice(i, i + 10))));
          snap.docs.forEach(d => allCleanings.push({ id: d.id, ...d.data() } as Cleaning));
        }
        setCleanings(allCleanings);

        const cleanersSnap = isAdminEmail(user.email)
          ? await getDocs(collection(db, 'cleaners'))
          : await getDocs(query(collection(db, 'cleaners'), where('ownerId', '==', user.uid)));
        setCleaners(cleanersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Cleaner)));
      } catch (err) {
        console.error('Failed to load calendar data', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [user]);

  // Weeks for current month view (Sunday first)
  const weeks = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const start = new Date(firstDay);
    start.setDate(start.getDate() - start.getDay());
    const result: Date[][] = [];
    const cur = new Date(start);
    while (true) {
      const week: Date[] = [];
      for (let d = 0; d < 7; d++) { week.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
      result.push(week);
      if (cur > lastDay) break;
    }
    return result;
  }, [viewDate]);

  // Pre-process events with display end calculation
  const processedEvents = useMemo((): ProcessedEvent[] => {
    const filtered = events.filter(e => activeProps.has(e.propertyId) && e.type !== 'block');
    // Collect all check-in dates per property
    const checkinsByProp: Record<string, Set<string>> = {};
    filtered.forEach(e => {
      const s = e.start.substring(0, 10);
      if (!checkinsByProp[e.propertyId]) checkinsByProp[e.propertyId] = new Set();
      checkinsByProp[e.propertyId].add(s);
    });
    return filtered.map(e => {
      const prop = properties.find(p => p.id === e.propertyId);
      const color = prop?.color ?? '#6366f1';
      const rawEnd = e.end.substring(0, 10); // checkout date
      const cleaning = cleanings.find(c => c.propertyId === e.propertyId && c.date === rawEnd);
      return {
        id: e.id, propertyId: e.propertyId, color, propName: prop?.name ?? '',
        start: e.start.substring(0, 10),
        end: rawEnd, // exclusive: day < end means "mid-stay"
        rawEnd,
        title: e.title, channelId: e.channelId, source: e.source, description: e.description,
        cleaningId: cleaning?.id ?? null, cleaner: cleaning?.cleaner ?? null, supplies: cleaning?.supplies ?? null,
      };
    });
  }, [events, cleanings, activeProps, properties]);

  const activeProperties = useMemo(() => properties.filter(p => activeProps.has(p.id)), [properties, activeProps]);

  const toggleProp = (propId: string) => {
    setActiveProps(prev => { const n = new Set(prev); n.has(propId) ? n.delete(propId) : n.add(propId); return n; });
  };

  const openModal = (e: ProcessedEvent) => {
    setSelectedEvent({
      title: e.title, start: e.start, end: e.rawEnd,
      propertyId: e.propertyId, propertyName: e.propName, propertyColor: e.color,
      channelLabel: getChannelLabel(e.channelId, e.source, channelMap),
      description: e.description, cleaningId: e.cleaningId, cleaner: e.cleaner, supplies: e.supplies,
    });
    setSelectedCleaner(e.cleaner ?? '');
    setSelectedSupplies(e.supplies ?? '');
  };

  const handleSaveCleaner = async () => {
    if (!selectedEvent || !user) return;
    setCleanerSaving(true);
    const checkoutDate = selectedEvent.end.substring(0, 10);
    const month = checkoutDate.substring(0, 7);
    try {
      if (selectedEvent.cleaningId) {
        await updateDoc(doc(db, 'cleanings', selectedEvent.cleaningId), { cleaner: selectedCleaner, supplies: selectedSupplies });
        setCleanings(prev => prev.map(c => c.id === selectedEvent.cleaningId ? { ...c, cleaner: selectedCleaner, supplies: selectedSupplies } : c));
      } else {
        const newDoc = await addDoc(collection(db, 'cleanings'), {
          propertyId: selectedEvent.propertyId, propertyName: selectedEvent.propertyName,
          date: checkoutDate, cleaner: selectedCleaner, supplies: selectedSupplies, month, createdAt: new Date().toISOString(),
        });
        setCleanings(prev => [...prev, { id: newDoc.id, propertyId: selectedEvent.propertyId, propertyName: selectedEvent.propertyName, date: checkoutDate, cleaner: selectedCleaner, supplies: selectedSupplies, month }]);
      }
      setSelectedEvent(null);
    } catch (err) { console.error(err); alert('저장에 실패했습니다.'); }
    finally { setCleanerSaving(false); }
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
    } catch (err) { console.error(err); alert('삭제에 실패했습니다.'); }
    finally { setCleanerSaving(false); }
  };

  // For a given day+property, classify what to show in the cell
  function getDayInfo(dayStr: string, propId: string) {
    const eventsForProp = processedEvents.filter(e => e.propertyId === propId);
    const checkoutEvent = eventsForProp.find(e => e.rawEnd === dayStr) ?? null;  // ends today
    const checkinEvent  = eventsForProp.find(e => e.start === dayStr) ?? null;   // starts today
    const midEvent = (!checkinEvent && !checkoutEvent)
      ? (eventsForProp.find(e => e.start < dayStr && e.end > dayStr) ?? null)
      : null;
    return { checkoutEvent, checkinEvent, midEvent };
  }

  const today = toDateStr(new Date());

  const prevMonth = () => { const d = new Date(viewDate); d.setMonth(d.getMonth() - 1); setViewDate(d); };
  const nextMonth = () => { const d = new Date(viewDate); d.setMonth(d.getMonth() + 1); setViewDate(d); };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-6 h-6 border-t-2 border-white rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <header className="pb-6 border-b border-white/10 flex flex-col sm:flex-row gap-4 sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-white/50 mb-4">캘린더</p>
          <h1 className="text-3xl md:text-4xl font-light tracking-tight text-white">통합 캘린더</h1>
          <p className="text-white/40 mt-2 text-sm font-light tracking-wide">모든 숙소의 투숙 및 청소 일정</p>
        </div>
        {/* Month navigation */}
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2.5 text-white/40 hover:text-white border border-white/10 hover:border-white/30 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-white font-light text-base px-4 min-w-[120px] text-center">
            {viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월
          </span>
          <button onClick={nextMonth} className="p-2.5 text-white/40 hover:text-white border border-white/10 hover:border-white/30 transition-colors">
            <ChevronRight size={16} />
          </button>
          <button onClick={() => setViewDate(new Date())} className="ml-2 px-3 py-2.5 text-[11px] uppercase tracking-widest font-semibold text-white/50 border border-white/10 hover:text-white hover:border-white/30 transition-colors">
            오늘
          </button>
        </div>
      </header>

      {/* Property filter pills */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-[10px] text-white/30 tracking-widest font-medium mr-1">숙소</span>
        {properties.map(p => {
          const on = activeProps.has(p.id);
          return (
            <button key={p.id} onClick={() => toggleProp(p.id)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] font-medium tracking-wide transition-all"
              style={{ borderColor: on ? p.color : 'rgba(255,255,255,0.1)', backgroundColor: on ? hexToRgba(p.color, 0.13) : 'transparent', color: on ? '#fff' : 'rgba(255,255,255,0.3)' }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: on ? p.color : 'rgba(255,255,255,0.15)' }} />
              {p.name}
            </button>
          );
        })}
      </div>

      {/* Calendar Grid */}
      <div className="overflow-x-auto -mx-4 md:mx-0">
      <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden min-w-[480px] mx-4 md:mx-0">
        {/* Day of week header */}
        <div className="grid grid-cols-7 border-b border-white/10">
          {DAY_LABELS.map((label, i) => (
            <div key={i} className={`py-3 text-center text-[11px] tracking-widest font-semibold ${i === 0 ? 'text-red-400/70' : i === 6 ? 'text-blue-400/70' : 'text-white/40'}`}>
              {label}
            </div>
          ))}
        </div>

        {/* Week rows */}
        {weeks.map((week, wi) => (
          <div key={wi} className={wi < weeks.length - 1 ? 'border-b border-white/25' : ''}>
            {/* Day numbers row */}
            <div className="grid grid-cols-7 border-b border-white/15">
              {week.map((day, di) => {
                const dateStr = toDateStr(day);
                const isThisMonth = day.getMonth() === viewDate.getMonth();
                const isToday = dateStr === today;
                return (
                  <div key={di} className={`py-2 px-2 text-right ${!isThisMonth ? 'opacity-20' : ''} ${di < 6 ? 'border-r border-white/15' : ''}`}>
                    <span className={`text-xs inline-flex items-center justify-center w-5 h-5 rounded-full transition-colors ${
                      isToday ? 'bg-white text-black font-semibold' :
                      di === 0 ? 'text-red-400/80' :
                      di === 6 ? 'text-blue-400/70' :
                      'text-white/35 font-light'
                    }`}>
                      {day.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Property lanes */}
            {activeProperties.length > 0 && (
              <div className="py-1.5 px-1.5 space-y-[3px]">
                {activeProperties.map(prop => {
                  const weekStartStr = toDateStr(week[0]);
                  return (
                    <div key={prop.id} className="flex h-7">
                      {week.map((day, di) => {
                        const dayStr = toDateStr(day);
                        const { checkoutEvent, checkinEvent, midEvent } = getDayInfo(dayStr, prop.id);
                        const bgEmpty = hexToRgba(prop.color, 0.04);

                        // ── Case 1: mid-stay ──
                        if (midEvent) {
                          const showLabel = di === 0 && midEvent.start < weekStartStr;
                          return (
                            <div key={di} className="relative flex-1 h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
                              onClick={() => openModal(midEvent)}
                              style={{ backgroundColor: midEvent.color }}
                            >
                              {showLabel && (
                                <span className="px-2 text-[11px] font-semibold text-white truncate leading-none drop-shadow-sm">
                                  {midEvent.title}
                                </span>
                              )}
                            </div>
                          );
                        }

                        // ── Case 2: 50/50 split (checkout left + checkin right) ──
                        if (checkoutEvent && checkinEvent) {
                          return (
                            <div key={di} className="relative flex-1 h-full flex" style={{ gap: '2px' }}>
                              {/* Left 50%: checkout */}
                              <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
                                onClick={() => openModal(checkoutEvent)}
                                style={{ width: '50%', backgroundColor: checkoutEvent.color, borderRadius: '0 6px 6px 0' }}
                              >
                                {checkoutEvent.cleaner && (
                                  <span className="mx-1 text-[9px] leading-none px-1.5 py-0.5 rounded-full font-medium shrink-0 whitespace-nowrap"
                                    style={{ backgroundColor: 'rgba(0,0,0,0.4)', color: '#fff' }}>
                                    🧹 {checkoutEvent.cleaner}
                                  </span>
                                )}
                              </div>
                              {/* Right 50%: checkin */}
                              <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
                                onClick={() => openModal(checkinEvent)}
                                style={{ width: '50%', backgroundColor: checkinEvent.color, borderRadius: '6px 0 0 6px' }}
                              >
                                <span className="px-1.5 text-[11px] font-semibold text-white truncate leading-none drop-shadow-sm">
                                  {checkinEvent.title}
                                </span>
                              </div>
                            </div>
                          );
                        }

                        // ── Case 3: checkout only — fixed 50% width, left-aligned ──
                        if (checkoutEvent) {
                          return (
                            <div key={di} className="relative flex-1 h-full flex items-center"
                              style={{ backgroundColor: bgEmpty }}
                            >
                              <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
                                onClick={() => openModal(checkoutEvent)}
                                style={{ width: '50%', backgroundColor: checkoutEvent.color, borderRadius: '0 6px 6px 0' }}
                              >
                                {checkoutEvent.cleaner && (
                                  <span className="mx-1 text-[9px] leading-none shrink-0 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap"
                                    style={{ backgroundColor: 'rgba(0,0,0,0.4)', color: '#fff' }}>
                                    🧹 {checkoutEvent.cleaner}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        }

                        // ── Case 4: checkin only — fixed 50% width, right-aligned ──
                        if (checkinEvent) {
                          return (
                            <div key={di} className="relative flex-1 h-full flex items-center justify-end"
                              style={{ backgroundColor: bgEmpty }}
                            >
                              <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
                                onClick={() => openModal(checkinEvent)}
                                style={{ width: '50%', backgroundColor: checkinEvent.color, borderRadius: '6px 0 0 6px' }}
                              >
                                <span className="px-2 text-[11px] font-semibold text-white truncate leading-none drop-shadow-sm">
                                  {checkinEvent.title}
                                </span>
                              </div>
                            </div>
                          );
                        }

                        // ── Case 5: empty ──
                        return <div key={di} className="flex-1 h-full" style={{ backgroundColor: bgEmpty }} />;
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      </div>

      {/* Property legend */}
      {activeProperties.length > 0 && (
        <div className="flex flex-wrap gap-4 px-1">
          {activeProperties.map(prop => (
            <div key={prop.id} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: prop.color }} />
              <span className="text-[11px] text-white/40 font-light">{prop.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setSelectedEvent(null)}>
          <div className="bg-[#161616] border border-white/10 rounded-2xl w-full max-w-sm mx-4 p-6 space-y-5" onClick={e => e.stopPropagation()}>
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
            <div className="space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-[10px] tracking-widest text-white/40">채널</span>
                <span className="text-white/80 text-[11px]">{selectedEvent.channelLabel}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] tracking-widest text-white/40">체크인</span>
                <span className="text-white/70 text-[11px] font-mono">{selectedEvent.start}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] tracking-widest text-white/40">체크아웃</span>
                <span className="text-white/70 text-[11px] font-mono">{selectedEvent.end}</span>
              </div>
              {selectedEvent.description && (() => {
                const filtered = selectedEvent.description
                  .split('\n')
                  .filter(line => !line.trimStart().startsWith('금액'))
                  .join('\n')
                  .trim();
                return filtered ? (
                  <div className="pt-2 border-t border-white/[0.08]">
                    <p className="text-[10px] tracking-widest text-white/30 mb-1.5">메모</p>
                    <p className="text-white/50 text-[11px] font-light whitespace-pre-line leading-relaxed">{filtered}</p>
                  </div>
                ) : null;
              })()}
            </div>

            {/* Cleaner CRUD */}
            <div className="border-t border-white/10 pt-5 space-y-3">
              <div>
                <p className="text-[10px] tracking-widest text-white/40 font-medium mb-2">청소 담당자</p>
                <select
                  value={selectedCleaner}
                  onChange={e => setSelectedCleaner(e.target.value)}
                  className="w-full bg-black/60 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors appearance-none"
                >
                  <option value="">담당자 없음</option>
                  {cleaners.map(c => (
                    <option key={c.id} value={c.name}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>
                  ))}
                  {selectedCleaner && !cleaners.some(c => c.name === selectedCleaner) && (
                    <option value={selectedCleaner}>{selectedCleaner}</option>
                  )}
                </select>
              </div>

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
                  <a href="/admin/cleaners" className="text-white/60 underline hover:text-white transition-colors">담당자 관리</a>
                  에서 먼저 추가하세요.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
