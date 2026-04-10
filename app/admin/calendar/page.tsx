'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { ChevronLeft, ChevronRight, X, Save, Trash2, Send, CheckCircle } from 'lucide-react';

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

interface Property { id: string; name: string; color: string; doorPassword?: string; addressUrl?: string; roomReadyMessage?: string; }
interface RawEvent { id: string; propertyId: string; channelId: string; source?: string; title: string; start: string; end: string; type: 'reservation' | 'block'; description?: string; }
interface Cleaning { id: string; propertyId: string; date: string; cleanerId: string; status: 'pending' | 'done'; supplies?: string; }
interface Cleaner { id: string; name: string; phone: string; }
interface SelectedEvent {
  eventId: string;
  title: string; start: string; end: string;
  propertyId: string; propertyName: string; propertyColor: string;
  channelId: string; channelLabel: string; description?: string;
  cleaningId: string | null; cleanerId: string | null; cleanerName: string | null;
  supplies: string | null; status: 'pending' | 'done' | null;
}

interface ProcessedEvent {
  id: string; propertyId: string; color: string; propName: string;
  start: string;    // check-in date (YYYY-MM-DD)
  end: string;      // checkout date (YYYY-MM-DD)
  title: string; channelId: string; source?: string; description?: string;
  cleaningId: string | null; cleanerId: string | null; cleanerName: string | null;
  supplies: string | null; status: 'pending' | 'done' | null;
}

export default function UnifiedCalendarPage() {
  const { user, profile } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [channelMap, setChannelMap] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [cleanings, setCleanings] = useState<Cleaning[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProps, setActiveProps] = useState<Set<string>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null);
  const [selectedCleaner, setSelectedCleaner] = useState('');
  const [cleanerSaving, setCleanerSaving] = useState(false);
  const [supplyTodos, setSupplyTodos] = useState<{id: string; text: string; done: boolean}[]>([]); // modal-scoped
  const [allSupplyTodos, setAllSupplyTodos] = useState<{id: string; propertyId: string; propertyName: string; date: string; text: string; done: boolean; createdAt: string}[]>([]);
  const [newSupply, setNewSupply] = useState('');
  const [viewDate, setViewDate] = useState(new Date());
  const [modalMessages, setModalMessages] = useState<{id: string; text: string; sender: string; createdAt: string}[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [completingCleaning, setCompletingCleaning] = useState(false);

  useEffect(() => {
    const currentUser = user;
    const isPublic = !currentUser; // no auth = public access
    const fetchAll = async () => {
      try {
        // Public or super_admin: show all properties; otherwise filter by owner
        const propsSnap = (isPublic || currentUser?.isAnonymous || profile?.role === 'super_admin')
          ? await getDocs(collection(db, 'properties'))
          : await getDocs(query(collection(db, 'properties'), where('ownerId', '==', currentUser!.uid)));
        const props: Property[] = propsSnap.docs.map((d, i) => {
          const data = d.data();
          return {
            id: d.id, name: data.name, color: PROPERTY_COLORS[i % PROPERTY_COLORS.length],
            doorPassword: data.doorPassword, addressUrl: data.addressUrl, roomReadyMessage: data.roomReadyMessage,
          };
        });
        setProperties(props);
        setActiveProps(new Set(props.map(p => p.id)));
        if (props.length === 0) return;
        const propIds = props.map(p => p.id);

        // Build channel map from embedded channels field
        const cMap: Record<string, string> = {};
        propsSnap.docs.forEach(d => {
          const propChannels = (d.data().channels ?? {}) as Record<string, unknown>;
          Object.keys(propChannels).forEach(name => { cMap[name] = name; });
        });
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

        const cleanersSnap = await getDocs(collection(db, 'cleaners'));
        setCleaners(cleanersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Cleaner)));

        // Load all supply TODOs (undone first)
        const supplySnap = await getDocs(collection(db, 'supply_todos'));
        const propsNameMap = new Map(props.map(p => [p.id, p.name]));
        setAllSupplyTodos(supplySnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id, propertyId: data.propertyId, propertyName: propsNameMap.get(data.propertyId) || '',
            date: data.date, text: data.text, done: data.done ?? false, createdAt: data.createdAt ?? '',
          };
        }));
      } catch (err) {
        console.error('Failed to load calendar data', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [user, profile]);

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

  const cleanersMap = useMemo(() =>
    new Map(cleaners.map(c => [c.id, c])),
  [cleaners]);

  // Pre-process events with display end calculation
  const processedEvents = useMemo((): ProcessedEvent[] => {
    const isStayfolioChannel = (channelId: string) =>
      channelId.toLowerCase() === 'stayfolio' || channelId === '스테이폴리오';

    const filtered = events.filter(e => {
      if (!activeProps.has(e.propertyId)) return false;
      if (e.type === 'block') return false;
      // Stayfolio sends cross-channel blocks as 1-day "Reserved" events — exclude them
      if (isStayfolioChannel(e.channelId)) {
        const diffMs = new Date(e.end.substring(0, 10)).getTime() - new Date(e.start.substring(0, 10)).getTime();
        if (diffMs <= 24 * 60 * 60 * 1000) return false;
      }
      return true;
    });
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
      const end = e.end.substring(0, 10);
      const cleaning = cleanings.find(c => c.propertyId === e.propertyId && c.date === end);
      const cleanerName = cleaning?.cleanerId ? (cleanersMap.get(cleaning.cleanerId)?.name ?? null) : null;
      return {
        id: e.id, propertyId: e.propertyId, color, propName: prop?.name ?? '',
        start: e.start.substring(0, 10),
        end,
        title: e.title, channelId: e.channelId, source: e.source, description: e.description,
        cleaningId: cleaning?.id ?? null,
        cleanerId: cleaning?.cleanerId ?? null,
        cleanerName,
        supplies: cleaning?.supplies ?? null,
        status: cleaning?.status ?? null,
      };
    });
  }, [events, cleanings, activeProps, properties, cleanersMap]);

  const activeProperties = useMemo(() => properties.filter(p => activeProps.has(p.id)), [properties, activeProps]);

  const eventsByProp = useMemo(() => {
    const map = new Map<string, ProcessedEvent[]>();
    processedEvents.forEach(e => {
      const list = map.get(e.propertyId) || [];
      list.push(e);
      map.set(e.propertyId, list);
    });
    return map;
  }, [processedEvents]);

  const toggleProp = (propId: string) => {
    setActiveProps(prev => { const n = new Set(prev); n.has(propId) ? n.delete(propId) : n.add(propId); return n; });
  };

  const openModal = (e: ProcessedEvent) => {
    setSelectedEvent({
      eventId: e.id,
      title: e.title, start: e.start, end: e.end,
      propertyId: e.propertyId, propertyName: e.propName, propertyColor: e.color,
      channelId: e.channelId, channelLabel: getChannelLabel(e.channelId, e.source, channelMap),
      description: e.description,
      cleaningId: e.cleaningId, cleanerId: e.cleanerId, cleanerName: e.cleanerName,
      supplies: e.supplies, status: e.status,
    });
    setSelectedCleaner(e.cleanerId ?? '');
  };

  const handleSaveCleaner = async () => {
    if (!selectedEvent) return;
    setCleanerSaving(true);
    const checkoutDate = selectedEvent.end.substring(0, 10);
    try {
      if (selectedEvent.cleaningId) {
        await updateDoc(doc(db, 'cleanings', selectedEvent.cleaningId), {
          cleanerId: selectedCleaner,
          updatedAt: new Date().toISOString(),
        });
        setCleanings(prev => prev.map(c =>
          c.id === selectedEvent.cleaningId ? { ...c, cleanerId: selectedCleaner } : c
        ));
      } else {
        const newDoc = await addDoc(collection(db, 'cleanings'), {
          propertyId: selectedEvent.propertyId,
          date: checkoutDate,
          cleanerId: selectedCleaner,
          status: 'pending' as const,
          createdAt: new Date().toISOString(),
        });
        setCleanings(prev => [...prev, {
          id: newDoc.id,
          propertyId: selectedEvent.propertyId,
          date: checkoutDate,
          cleanerId: selectedCleaner,
          status: 'pending' as const,
        }]);
      }
      setSelectedEvent(null);
    } catch (err) { console.error(err); alert('저장에 실패했습니다.'); }
    finally { setCleanerSaving(false); }
  };

  // Supply TODO handlers
  const handleAddSupply = async () => {
    if (!selectedEvent || !newSupply.trim()) return;
    const checkoutDate = selectedEvent.end.substring(0, 10);
    const now = new Date().toISOString();
    try {
      const docRef = await addDoc(collection(db, 'supply_todos'), {
        propertyId: selectedEvent.propertyId,
        date: checkoutDate,
        text: newSupply.trim(),
        done: false,
        createdAt: now,
      });
      const newItem = { id: docRef.id, text: newSupply.trim(), done: false };
      setSupplyTodos(prev => [...prev, newItem]);
      setAllSupplyTodos(prev => [...prev, {
        ...newItem, propertyId: selectedEvent.propertyId,
        propertyName: selectedEvent.propertyName, date: checkoutDate, createdAt: now,
      }]);
      setNewSupply('');
    } catch (err) { console.error(err); alert('비품 추가에 실패했습니다.'); }
  };

  const handleToggleSupply = async (todoId: string, done: boolean, updateLocal = true) => {
    try {
      await updateDoc(doc(db, 'supply_todos', todoId), { done });
      if (updateLocal) setSupplyTodos(prev => prev.map(t => t.id === todoId ? { ...t, done } : t));
      setAllSupplyTodos(prev => prev.map(t => t.id === todoId ? { ...t, done } : t));
    } catch (err) { console.error(err); }
  };

  const handleDeleteSupply = async (todoId: string, updateLocal = true) => {
    try {
      await deleteDoc(doc(db, 'supply_todos', todoId));
      if (updateLocal) setSupplyTodos(prev => prev.filter(t => t.id !== todoId));
      setAllSupplyTodos(prev => prev.filter(t => t.id !== todoId));
    } catch (err) { console.error(err); alert('삭제에 실패했습니다.'); }
  };

  const DEFAULT_ROOM_READY_MESSAGE = '객실 정비가 완료되었습니다. 체크인 준비가 되었으니 편안한 시간 보내시길 바랍니다.';

  const getRoomReadyMessage = (propertyId: string) => {
    const prop = properties.find(p => p.id === propertyId);
    if (!prop) return DEFAULT_ROOM_READY_MESSAGE;
    const template = prop.roomReadyMessage || DEFAULT_ROOM_READY_MESSAGE;
    let msg = template
      .replace(/\{password\}/g, prop.doorPassword || '')
      .replace(/\{address\}/g, prop.addressUrl || '');
    // 커스텀 템플릿이 없으면 비밀번호/주소를 자동 첨부
    if (!prop.roomReadyMessage && (prop.doorPassword || prop.addressUrl)) {
      if (prop.doorPassword) msg += `\n\n비밀번호: ${prop.doorPassword}`;
      if (prop.addressUrl) msg += `\n주소: ${prop.addressUrl}`;
    }
    return msg;
  };

  const handleCompleteCleaning = async () => {
    if (!selectedEvent?.cleaningId) return;
    setCompletingCleaning(true);
    try {
      await updateDoc(doc(db, 'cleanings', selectedEvent.cleaningId), {
        status: 'done',
        updatedAt: new Date().toISOString(),
      });
      setCleanings(prev => prev.map(c =>
        c.id === selectedEvent.cleaningId ? { ...c, status: 'done' as const } : c
      ));
      // Beds24 연동 건이면 게스트에게 메시지 전송
      if (selectedEvent.channelId === 'beds24' && user) {
        try {
          const token = await user.getIdToken();
          await fetch('/api/beds24/messages/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
              eventId: selectedEvent.eventId,
              propertyId: selectedEvent.propertyId,
              text: getRoomReadyMessage(selectedEvent.propertyId),
            }),
          });
        } catch { /* 메시지 전송 실패해도 정비 완료는 유지 */ }
      }
      setSelectedEvent(prev => prev ? { ...prev, status: 'done' } : null);
    } catch (err) { console.error(err); alert('정비 완료 처리에 실패했습니다.'); }
    finally { setCompletingCleaning(false); }
  };

  const handleDeleteCleaner = async () => {
    if (!selectedEvent?.cleaningId) return;
    if (!confirm('청소 담당자 배정을 삭제하시겠습니까?')) return;
    setCleanerSaving(true);
    try {
      await deleteDoc(doc(db, 'cleanings', selectedEvent.cleaningId));
      setCleanings(prev => prev.filter(c => c.id !== selectedEvent.cleaningId));
      setSelectedEvent(prev => prev ? { ...prev, cleaningId: null, cleanerId: null, cleanerName: null, supplies: null, status: null } : null);
      setSelectedCleaner('');
    } catch (err) { console.error(err); alert('삭제에 실패했습니다.'); }
    finally { setCleanerSaving(false); }
  };

  // Load supply TODOs when modal opens
  useEffect(() => {
    if (!selectedEvent) { setSupplyTodos([]); setNewSupply(''); return; }
    const checkoutDate = selectedEvent.end.substring(0, 10);
    const loadSupplies = async () => {
      try {
        const q = query(
          collection(db, 'supply_todos'),
          where('propertyId', '==', selectedEvent.propertyId),
          where('date', '==', checkoutDate)
        );
        const snap = await getDocs(q);
        setSupplyTodos(snap.docs.map(d => ({ id: d.id, text: d.data().text, done: d.data().done })));
      } catch { setSupplyTodos([]); }
    };
    loadSupplies();
  }, [selectedEvent?.eventId]);

  // Subscribe to messages in real-time when modal opens
  useEffect(() => {
    if (!selectedEvent?.eventId) {
      setModalMessages([]);
      setNewMessage('');
      return;
    }
    setLoadingMessages(true);
    const q = query(
      collection(db, 'messages'),
      where('eventId', '==', selectedEvent.eventId),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setModalMessages(snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, text: data.text, sender: data.sender, createdAt: data.createdAt };
      }));
      setLoadingMessages(false);
    }, () => {
      setModalMessages([]);
      setLoadingMessages(false);
    });
    return () => unsub();
  }, [selectedEvent?.eventId]);

  const handleSendMessage = async () => {
    if (!selectedEvent?.eventId || !newMessage.trim() || sendingMessage || !user) return;
    setSendingMessage(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/beds24/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          eventId: selectedEvent.eventId,
          propertyId: selectedEvent.propertyId,
          text: newMessage.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '전송 실패');
      setNewMessage('');
    } catch {
      alert('메시지 전송에 실패했습니다.');
    } finally {
      setSendingMessage(false);
    }
  };

  // For a given day+property, classify what to show in the cell
  function getDayInfo(dayStr: string, propId: string) {
    const eventsForProp = eventsByProp.get(propId) || [];
    const checkoutEvent = eventsForProp.find(e => e.end === dayStr) ?? null;  // ends today
    const checkinEvent  = eventsForProp.find(e => e.start === dayStr) ?? null;   // starts today
    const midEvent = (!checkinEvent && !checkoutEvent)
      ? (eventsForProp.find(e => e.start < dayStr && e.end > dayStr) ?? null)
      : null;
    return { checkoutEvent, checkinEvent, midEvent };
  }

  // Compute availability: for each day, how many active properties are free
  function getDayAvailability(dayStr: string): { available: number; total: number } {
    const total = activeProperties.length;
    let available = 0;
    for (const prop of activeProperties) {
      const { checkoutEvent, checkinEvent, midEvent } = getDayInfo(dayStr, prop.id);
      // A property is available if there's no check-in or mid-stay on that day
      // (checkout day itself is available for new check-in)
      if (!checkinEvent && !midEvent) available++;
    }
    return { available, total };
  }

  // ── Compute unassigned cleaning events (current view month, future only) ──
  const unassignedCleanings = useMemo(() => {
    const todayStr = toDateStr(new Date());
    const monthStart = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-01`;
    const nextMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    const monthEnd = toDateStr(nextMonth); // exclusive
    return processedEvents.filter(e =>
      e.end >= todayStr && e.end >= monthStart && e.end < monthEnd && !e.cleanerId
    );
  }, [processedEvents, viewDate]);

  const sortedUnassigned = useMemo(() =>
    [...unassignedCleanings].sort((a, b) => a.end.localeCompare(b.end)),
  [unassignedCleanings]);

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
        <div className="flex items-center gap-1.5">
          <button onClick={prevMonth} className="p-2.5 text-white/40 hover:text-white border border-white/10 hover:border-white/30 rounded-lg transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-white font-light text-base px-4 min-w-[140px] text-center tabular-nums">
            {viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월
          </span>
          <button onClick={nextMonth} className="p-2.5 text-white/40 hover:text-white border border-white/10 hover:border-white/30 rounded-lg transition-colors">
            <ChevronRight size={16} />
          </button>
          <button onClick={() => setViewDate(new Date())} className="ml-2 px-3.5 py-2.5 text-[11px] uppercase tracking-widest font-semibold text-white/50 border border-white/10 hover:text-white hover:border-white/30 rounded-lg transition-colors">
            오늘
          </button>
        </div>
      </header>

      {/* ── Unassigned cleaning alert banner ── */}
      {unassignedCleanings.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-5 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
            <p className="text-sm text-amber-200/90 font-light">
              <span className="font-semibold">{unassignedCleanings.length}건</span>의 예약에 청소 담당자가 지정되지 않았습니다
            </p>
          </div>
          <button
            onClick={() => {
              // Open modal for the nearest unassigned event
              const sorted = sortedUnassigned;
              if (sorted[0]) openModal(sorted[0]);
            }}
            className="px-3.5 py-1.5 text-[11px] tracking-widest font-semibold text-amber-300 border border-amber-500/30 hover:bg-amber-500/15 rounded-lg transition-colors whitespace-nowrap"
          >
            지정하기
          </button>
        </div>
      )}

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

      {/* Legend */}
      <div className="flex items-center gap-5 text-[10px] text-white/40 tracking-wide">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400/80" />
          전체 예약 가능
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400/60" />
          일부 예약 가능
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-400/50" />
          예약 불가
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="overflow-x-auto -mx-4 md:mx-0">
      <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden min-w-[480px] mx-4 md:mx-0">
        {/* Day of week header */}
        <div className="grid grid-cols-7 border-b border-white/10">
          {DAY_LABELS.map((label, i) => (
            <div key={i} className={`py-3 text-center text-[11px] tracking-widest font-semibold ${i === 0 ? 'text-red-400/70' : i === 6 ? 'text-blue-400/70' : 'text-white/40'} ${i < 6 ? 'border-r border-white/15' : ''}`}>
              {label}
            </div>
          ))}
        </div>

        {/* Week rows */}
        {weeks.map((week, wi) => (
          <div key={wi} className={wi < weeks.length - 1 ? 'border-b border-white/[0.08]' : ''}>
            {/* Day numbers row */}
            <div className="grid grid-cols-7 border-b border-white/[0.06]">
              {week.map((day, di) => {
                const dateStr = toDateStr(day);
                const isThisMonth = day.getMonth() === viewDate.getMonth();
                const isToday = dateStr === today;
                const isPast = dateStr < today;
                const weekendBg = di === 0 ? 'bg-red-500/[0.03]' : di === 6 ? 'bg-blue-500/[0.03]' : '';
                const avail = isThisMonth && activeProperties.length > 0 ? getDayAvailability(dateStr) : null;
                const allAvailable = avail && avail.available === avail.total && avail.total > 0;
                const noneAvailable = avail && avail.available === 0 && avail.total > 0;
                const partialAvailable = avail && !allAvailable && !noneAvailable && avail.total > 0;
                return (
                  <div key={di} className={`py-2 px-2 flex items-center justify-between ${!isThisMonth ? 'opacity-20' : ''} ${isToday ? 'bg-white/[0.05]' : weekendBg} ${di < 6 ? 'border-r border-white/15' : ''}`}>
                    {/* Availability dot */}
                    <div className="w-4 flex justify-center">
                      {avail && !isPast && isThisMonth && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            allAvailable ? 'bg-emerald-400/80' :
                            noneAvailable ? 'bg-red-400/50' :
                            'bg-amber-400/60'
                          }`}
                          title={`${avail.available}/${avail.total} 숙소 예약 ��능`}
                        />
                      )}
                    </div>
                    <span className={`text-xs inline-flex items-center justify-center w-6 h-6 rounded-full transition-colors ${
                      isToday ? 'bg-white text-black font-semibold' :
                      di === 0 ? 'text-red-400/80' :
                      di === 6 ? 'text-blue-400/70' :
                      'text-white/40 font-light'
                    }`}>
                      {day.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Property lanes — use grid for vertical alignment with day columns */}
            {activeProperties.length > 0 && (
              <div className="space-y-0">
                {activeProperties.map((prop, pi) => {
                  const weekStartStr = toDateStr(week[0]);
                  return (
                    <div key={prop.id} className={`grid grid-cols-7 ${pi < activeProperties.length - 1 ? '' : ''}`} style={{ height: '32px' }}>
                      {week.map((day, di) => {
                        const dayStr = toDateStr(day);
                        const { checkoutEvent, checkinEvent, midEvent } = getDayInfo(dayStr, prop.id);
                        const bgEmpty = hexToRgba(prop.color, 0.04);
                        const weekendBg = di === 0 ? 'rgba(239,68,68,0.02)' : di === 6 ? 'rgba(59,130,246,0.02)' : undefined;
                        const emptyBg = weekendBg || bgEmpty;

                        // Cleaning badge helper
                        const renderCleanBadge = (evt: ProcessedEvent) => {
                          if (evt.cleanerName) {
                            const badgeBg = evt.status === 'done' ? 'rgba(16,185,129,0.7)' : 'rgba(0,0,0,0.45)';
                            return (
                              <span className="mx-0.5 text-[8px] leading-none px-1.5 py-0.5 rounded-full font-semibold shrink-0 whitespace-nowrap"
                                style={{ backgroundColor: badgeBg, color: '#fff' }}>
                                {evt.status === 'done' ? '✓' : '🧹'} {evt.cleanerName}
                              </span>
                            );
                          }
                          // No cleaner assigned — show warning dot
                          return (
                            <span className="mx-0.5 w-2 h-2 rounded-full shrink-0 bg-amber-400/80 animate-pulse" title="청소 미배정" />
                          );
                        };

                        const gridLine = di < 6 ? <span className="absolute right-0 top-0 w-px h-full bg-white/15 z-10 pointer-events-none" /> : null;

                        // ── Case 1: mid-stay ──
                        if (midEvent) {
                          const showLabel = di === 0 && midEvent.start < weekStartStr;
                          return (
                            <div key={di} className="relative h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
                              onClick={() => openModal(midEvent)}
                              style={{ backgroundColor: midEvent.color }}
                            >
                              {showLabel && (
                                <span className="px-2 text-[10px] font-semibold text-white truncate leading-none drop-shadow-sm">
                                  {midEvent.title}
                                </span>
                              )}
                              {gridLine}
                            </div>
                          );
                        }

                        // ── Case 2: 50/50 split (checkout left + checkin right) ──
                        if (checkoutEvent && checkinEvent) {
                          return (
                            <div key={di} className="relative h-full flex" style={{ gap: '2px' }}>
                              <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
                                onClick={() => openModal(checkoutEvent)}
                                style={{ width: '50%', backgroundColor: checkoutEvent.color, borderRadius: '0 6px 6px 0', opacity: 0.75 }}
                              >
                                {renderCleanBadge(checkoutEvent)}
                              </div>
                              <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
                                onClick={() => openModal(checkinEvent)}
                                style={{ width: '50%', backgroundColor: checkinEvent.color, borderRadius: '6px 0 0 6px' }}
                              >
                                <span className="px-1 text-[10px] font-semibold text-white truncate leading-none drop-shadow-sm">
                                  {checkinEvent.title}
                                </span>
                              </div>
                              {gridLine}
                            </div>
                          );
                        }

                        // ── Case 3: checkout only ──
                        if (checkoutEvent) {
                          return (
                            <div key={di} className="relative h-full flex items-center"
                              style={{ backgroundColor: emptyBg }}
                            >
                              <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
                                onClick={() => openModal(checkoutEvent)}
                                style={{ width: '50%', backgroundColor: checkoutEvent.color, borderRadius: '0 6px 6px 0', opacity: 0.75 }}
                              >
                                {renderCleanBadge(checkoutEvent)}
                              </div>
                              {gridLine}
                            </div>
                          );
                        }

                        // ── Case 4: checkin only ──
                        if (checkinEvent) {
                          return (
                            <div key={di} className="relative h-full flex items-center justify-end"
                              style={{ backgroundColor: emptyBg }}
                            >
                              <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
                                onClick={() => openModal(checkinEvent)}
                                style={{ width: '50%', backgroundColor: checkinEvent.color, borderRadius: '6px 0 0 6px' }}
                              >
                                <span className="px-1.5 text-[10px] font-semibold text-white truncate leading-none drop-shadow-sm">
                                  {checkinEvent.title}
                                </span>
                              </div>
                              {gridLine}
                            </div>
                          );
                        }

                        // ── Case 5: empty (available) ──
                        const dayIsPast = dayStr < today;
                        return (
                          <div key={di} className="relative h-full flex items-center justify-center" style={{ backgroundColor: emptyBg }}>
                            {!dayIsPast && day.getMonth() === viewDate.getMonth() && (
                              <span className="w-1 h-1 rounded-full bg-emerald-500/25" />
                            )}
                            {gridLine}
                          </div>
                        );
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

      {/* ── Global Supply TODO list ── */}
      {(() => {
        const pending = allSupplyTodos.filter(t => !t.done);
        const done = allSupplyTodos.filter(t => t.done);
        if (pending.length === 0 && done.length === 0) return null;

        // Group pending by propertyName
        const grouped = new Map<string, typeof pending>();
        pending.forEach(t => {
          const list = grouped.get(t.propertyName) || [];
          list.push(t);
          grouped.set(t.propertyName, list);
        });

        return (
          <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white/80 tracking-wide">필요 비품</h3>
              <span className="text-[10px] text-white/30 tabular-nums">{pending.length}개 미완료</span>
            </div>

            {pending.length > 0 && (
              <div className="space-y-4">
                {Array.from(grouped.entries()).map(([propName, items]) => (
                  <div key={propName} className="space-y-1.5">
                    <p className="text-[10px] tracking-widest text-white/40 font-medium">{propName}</p>
                    {items.map(todo => (
                      <div key={todo.id} className="flex items-center gap-3 group py-1">
                        <button
                          onClick={() => handleToggleSupply(todo.id, true, false)}
                          className="w-4 h-4 rounded border border-white/20 hover:border-emerald-400/60 flex items-center justify-center shrink-0 transition-colors"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] text-white/70">{todo.text}</p>
                          <p className="text-[10px] text-white/25 mt-0.5">{todo.date}</p>
                        </div>
                        <button
                          onClick={() => handleDeleteSupply(todo.id, false)}
                          className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all shrink-0"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {done.length > 0 && (
              <details className="group">
                <summary className="text-[10px] text-white/25 cursor-pointer hover:text-white/40 transition-colors tracking-wide list-none flex items-center gap-1.5">
                  <ChevronRight size={10} className="group-open:rotate-90 transition-transform" />
                  완료 ({done.length})
                </summary>
                <div className="mt-2 space-y-1">
                  {done.map(todo => (
                    <div key={todo.id} className="flex items-center gap-3 group py-1">
                      <button
                        onClick={() => handleToggleSupply(todo.id, false, false)}
                        className="w-4 h-4 rounded bg-emerald-500/30 border border-emerald-500/50 flex items-center justify-center shrink-0 transition-colors"
                      >
                        <span className="text-emerald-400 text-[10px]">✓</span>
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-white/30 line-through">{todo.text}</p>
                        <p className="text-[10px] text-white/15 mt-0.5">{todo.propertyName} · {todo.date}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteSupply(todo.id, false)}
                        className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })()}

      {/* Side Panel */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={() => setSelectedEvent(null)}>
          <div className="bg-[#161616] border-l border-white/10 w-full max-w-md p-6 space-y-5 h-full overflow-y-auto animate-slide-in-right" onClick={e => e.stopPropagation()}>
            {/* Unassigned navigation */}
            {unassignedCleanings.length > 0 && !selectedEvent.cleanerId && (
              <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <span className="text-[10px] text-amber-300/80 tracking-wide">
                  미지정 {(() => {
                    const sorted = sortedUnassigned;
                    const idx = sorted.findIndex(e => e.id === selectedEvent.eventId);
                    return `${idx + 1}/${sorted.length}`;
                  })()}
                </span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => {
                      const sorted = sortedUnassigned;
                      const idx = sorted.findIndex(e => e.id === selectedEvent.eventId);
                      const prev = sorted[(idx - 1 + sorted.length) % sorted.length];
                      if (prev) openModal(prev);
                    }}
                    className="px-2 py-1 text-[10px] text-amber-300/60 border border-amber-500/20 rounded hover:bg-amber-500/15 transition-colors"
                  >
                    <ChevronLeft size={12} />
                  </button>
                  <button
                    onClick={() => {
                      const sorted = sortedUnassigned;
                      const idx = sorted.findIndex(e => e.id === selectedEvent.eventId);
                      const next = sorted[(idx + 1) % sorted.length];
                      if (next) openModal(next);
                    }}
                    className="px-2 py-1 text-[10px] text-amber-300/60 border border-amber-500/20 rounded hover:bg-amber-500/15 transition-colors"
                  >
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            )}
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
            <div className="space-y-2.5 bg-white/[0.03] rounded-xl px-4 py-3.5">
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
              {(() => {
                const nights = Math.round((new Date(selectedEvent.end).getTime() - new Date(selectedEvent.start).getTime()) / 86400000);
                return nights > 0 ? (
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] tracking-widest text-white/40">숙박</span>
                    <span className="text-white/70 text-[11px]">{nights}박 {nights + 1}일</span>
                  </div>
                ) : null;
              })()}
              {selectedEvent.description && (() => {
                const filtered = selectedEvent.description
                  .split('\n')
                  .filter(line => !line.trimStart().startsWith('금액'))
                  .join('\n')
                  .trim();
                return filtered ? (
                  <div className="pt-2.5 mt-1 border-t border-white/[0.06]">
                    <p className="text-[10px] tracking-widest text-white/30 mb-1.5">예약 메모</p>
                    <p className="text-white/50 text-[11px] font-light whitespace-pre-line leading-relaxed">{filtered}</p>
                  </div>
                ) : null;
              })()}
            </div>

            {/* Cleaner Assignment */}
            <div className="border-t border-white/[0.08] pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] tracking-widest text-white/40 font-medium">청소 담당자</p>
                {selectedEvent.cleaningId && (
                  <button
                    onClick={handleDeleteCleaner}
                    disabled={cleanerSaving}
                    className="text-[10px] text-white/30 hover:text-red-400 transition-colors disabled:opacity-40 flex items-center gap-1"
                    title="배정 삭제"
                  >
                    <Trash2 size={10} />
                    해제
                  </button>
                )}
              </div>

              {cleaners.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {cleaners.map(c => {
                    const isSelected = selectedCleaner === c.id;
                    const isCurrent = selectedEvent.cleanerId === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedCleaner(isSelected ? '' : c.id)}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-all ${
                          isSelected
                            ? 'border-white/30 bg-white/10 text-white'
                            : 'border-white/10 bg-black/30 text-white/50 hover:border-white/20 hover:text-white/70'
                        }`}
                      >
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${
                          isSelected ? 'bg-white text-black' : 'bg-white/10 text-white/40'
                        }`}>
                          {c.name.charAt(0)}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium truncate">
                            {c.name}
                            {isCurrent && <span className="ml-1 text-[9px] text-emerald-400">현재</span>}
                          </p>
                          {c.phone && <p className="text-[10px] text-white/30 truncate">{c.phone}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[10px] text-white/30 text-center py-2">
                  등록된 담당자가 없습니다.{' '}
                  <a href="/admin/cleaners" className="text-white/60 underline hover:text-white transition-colors">담당자 관리</a>
                  에서 먼저 추가하세요.
                </p>
              )}

              {selectedCleaner !== (selectedEvent.cleanerId ?? '') && (
                <button
                  onClick={handleSaveCleaner}
                  disabled={cleanerSaving}
                  className="w-full flex items-center justify-center gap-2 bg-white text-black py-2.5 rounded-lg text-[11px] tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Save size={13} />
                  {cleanerSaving ? '저장 중...' : '저장'}
                </button>
              )}

              {/* 정비 완료 버튼 — 담당자 배정 완료 + 아직 pending인 경우에만 표시 */}
              {selectedEvent.cleaningId && selectedEvent.status !== 'done' && (
                <button
                  onClick={handleCompleteCleaning}
                  disabled={completingCleaning}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-2.5 rounded-lg text-[11px] tracking-widest font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <CheckCircle size={13} />
                  {completingCleaning ? '처리 중...' : '정비 완료'}
                  {selectedEvent.channelId === 'beds24' && !completingCleaning && (
                    <span className="text-[9px] font-normal text-emerald-200/70 ml-1">· 게스트 알림</span>
                  )}
                </button>
              )}

              {selectedEvent.status === 'done' && (
                <div className="flex items-center gap-2 py-2 px-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <CheckCircle size={13} className="text-emerald-400 shrink-0" />
                  <span className="text-[11px] text-emerald-300/80">정비 완료</span>
                </div>
              )}
            </div>

            {/* ── Supply TODO list ── */}
            <div className="border-t border-white/[0.08] pt-5 space-y-3">
              <p className="text-[10px] tracking-widest text-white/40 font-medium">필요 비품</p>

              {supplyTodos.length > 0 && (
                <div className="space-y-1.5">
                  {supplyTodos.map(todo => (
                    <div key={todo.id} className="flex items-center gap-2.5 group">
                      <button
                        onClick={() => handleToggleSupply(todo.id, !todo.done)}
                        className={`w-4.5 h-4.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          todo.done ? 'bg-emerald-500/30 border-emerald-500/50' : 'border-white/20 hover:border-white/40'
                        }`}
                      >
                        {todo.done && <span className="text-emerald-400 text-[10px]">✓</span>}
                      </button>
                      <span className={`text-[12px] flex-1 ${todo.done ? 'text-white/30 line-through' : 'text-white/70'}`}>
                        {todo.text}
                      </span>
                      <button
                        onClick={() => handleDeleteSupply(todo.id)}
                        className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  value={newSupply}
                  onChange={e => setNewSupply(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddSupply()}
                  placeholder="비품 항목 추가 (예: 수건 4장)"
                  className="flex-1 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white focus:outline-none focus:border-white/30 transition-colors placeholder:text-white/20"
                />
                <button
                  onClick={handleAddSupply}
                  disabled={!newSupply.trim()}
                  className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white/60 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  추가
                </button>
              </div>
            </div>

            {/* ── Messages / Memo ── */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] tracking-[0.2em] text-white/40 uppercase">메시지 / 메모</p>
              </div>

              {loadingMessages ? (
                <p className="text-[10px] text-white/30 text-center py-4">불러오는 중...</p>
              ) : modalMessages.length > 0 ? (
                <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                  {modalMessages.map(msg => (
                    <div key={msg.id} className={`text-xs p-3 rounded-lg ${msg.sender === 'host' ? 'bg-white/10 ml-4' : 'bg-indigo-500/20 mr-4'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-medium text-white/60">{msg.sender === 'host' ? '호스트' : '게스트'}</span>
                        <span className="text-[9px] text-white/30">{new Date(msg.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="text-white/80 leading-relaxed">{msg.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-white/30 text-center py-2">메모가 없습니다.</p>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                  placeholder="메모 추가..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim() || sendingMessage}
                  className="px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Send size={13} className="text-white/70" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
