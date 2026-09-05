'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import {
  PROPERTY_COLORS, DISABLED_PROPERTY_NAMES,
  type Property, type RawEvent, type Cleaning, type Cleaner,
  type ProcessedEvent, type GlobalSupplyTodo, toDateStr,
} from '../types';

export function useCalendarData() {
  const { user, profile } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [channelMap, setChannelMap] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [cleanings, setCleanings] = useState<Cleaning[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProps, setActiveProps] = useState<Set<string>>(new Set());
  const [allSupplyTodos, setAllSupplyTodos] = useState<GlobalSupplyTodo[]>([]);
  const [viewDate, setViewDate] = useState(new Date());

  useEffect(() => {
    const isLoggedIn = !!user;
    let cancelled = false;
    const fetchAll = async () => {
      try {
        if (isLoggedIn) {
          const res = await fetch('/api/admin/calendar');
          if (!res.ok) throw new Error('Failed to fetch admin calendar');
          const data = await res.json();
          if (cancelled) return;

          const props: Property[] = (data.properties ?? []).map((d: Record<string, unknown>, i: number) => ({
            id: d.id as string, name: d.name as string, color: PROPERTY_COLORS[i % PROPERTY_COLORS.length],
            doorPassword: d.doorPassword as string | undefined, addressUrl: d.addressUrl as string | undefined,
            roomReadyMessage: d.roomReadyMessage as string | undefined,
          }));
          setProperties(props);
          setActiveProps(new Set(props.filter(p => !DISABLED_PROPERTY_NAMES.includes(p.name)).map(p => p.id)));
          setChannelMap(data.channelMap ?? {});

          const allEvents: RawEvent[] = (data.events ?? []).map((e: Record<string, unknown>) => ({
            id: e.id as string, propertyId: e.propertyId as string, channelId: (e.channelId as string) || '',
            source: e.source as string | undefined,
            title: (e.title as string) || '',
            start: (e.startDate || e.start) as string, end: (e.endDate || e.end) as string,
            type: (e.type as 'reservation' | 'block') || 'reservation',
            description: e.description as string | undefined,
            tags: Array.isArray(e.tags) ? (e.tags as string[]) : [],
            originalUid: (e.originalUid as string | null) ?? null,
          }));
          for (const bk of data.bookings ?? []) {
            allEvents.push({
              id: bk.id, propertyId: bk.propertyId, channelId: 'direct', source: 'direct',
              title: `${bk.name} 예약`, start: bk.checkIn, end: bk.checkOut, type: 'reservation',
              description: `게스트: ${bk.name}\n연락처: ${bk.email}\n인원: ${bk.guests}명`,
              tags: [], originalUid: null,
            });
          }
          setEvents(allEvents);

          const cleaningsData = data.cleanings ?? [];
          setCleanings(cleaningsData.map((c: Record<string, unknown>) => ({
            id: c.id, propertyId: c.propertyId, date: c.date, cleanerId: c.cleanerId || '',
            status: c.status || 'pending', supplies: c.supplies,
          })));
          setCleaners(data.cleaners ?? []);
          setLoading(false);

          // Supply todos are deferred to a second roundtrip so the calendar
          // grid (events + cleanings) renders without waiting on the supply
          // panel data.
          const propsNameMap = new Map(props.map(p => [p.id, p.name]));
          fetch('/api/admin/calendar/supply-todos')
            .then(r => (r.ok ? r.json() : { supplyTodos: [] }))
            .then(sd => {
              if (cancelled) return;
              const supplyData = sd.supplyTodos ?? [];
              setAllSupplyTodos(supplyData.map((d: Record<string, unknown>) => ({
                id: d.id as string, propertyId: d.propertyId as string,
                propertyName: propsNameMap.get(d.propertyId as string) || '',
                date: d.date as string, text: d.text as string,
                done: (d.done as boolean) ?? false, createdAt: (d.createdAt as string) ?? '',
              })));
            })
            .catch(err => console.error('Failed to load supply todos', err));
          return;
        } else {
          // 관리자 캘린더는 로그인 뒤에만 열린다. 예전의 비로그인 폴백(/api/public/calendar)은
          // 인증 없이 전 숙소의 도어락·게스트 연락처를 노출해 제거했다.
          setProperties([]);
          setEvents([]);
          setCleanings([]);
          setCleaners([]);
          setAllSupplyTodos([]);
        }
      } catch (err) {
        console.error('Failed to load calendar data', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchAll();
    return () => { cancelled = true; };
  }, [user, profile]);

  // Weeks for current month view
  const weeks = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const start = new Date(firstDay);
    start.setDate(start.getDate() - start.getDay());
    const result: Date[][] = [];
    const cur = new Date(start);
    for (let w = 0; w < 6 && !(w > 0 && cur > lastDay); w++) {
      const week: Date[] = [];
      for (let d = 0; d < 7; d++) { week.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
      result.push(week);
    }
    return result;
  }, [viewDate]);

  const cleanersMap = useMemo(() => new Map(cleaners.map(c => [c.id, c])), [cleaners]);

  const propertiesMap = useMemo(
    () => new Map(properties.map(p => [p.id, p])),
    [properties],
  );

  const cleaningsIndex = useMemo(() => {
    // Multiple cleaning rows can exist for the same (propertyId, date) —
    // typically one auto-created by iCal sync (cleanerId=null) and one
    // assigned (cleanerId=set). We must prefer the assigned row;
    // otherwise the calendar mistakenly shows the slot as unassigned.
    const map = new Map<string, Cleaning>();
    for (const c of cleanings) {
      const key = `${c.propertyId}_${c.date}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, c);
      } else if (c.cleanerId && !existing.cleanerId) {
        map.set(key, c);
      }
      // otherwise keep the existing (assigned-or-equal) row
    }
    return map;
  }, [cleanings]);

  const processedEvents = useMemo((): ProcessedEvent[] => {
    const isStayfolioChannel = (channelId: string) =>
      channelId.toLowerCase() === 'stayfolio' || channelId === '스테이폴리오';

    const filtered = events.filter(e => {
      if (!activeProps.has(e.propertyId)) return false;
      // Show Beds24 blocks (manual or synced from Beds24 "black" status); hide OTA iCal blocks
      if (e.type === 'block' && e.channelId !== 'beds24') return false;
      if (isStayfolioChannel(e.channelId)) {
        const diffMs = new Date(e.end.substring(0, 10)).getTime() - new Date(e.start.substring(0, 10)).getTime();
        if (diffMs <= 24 * 60 * 60 * 1000) return false;
      }
      return true;
    });
    return filtered.map(e => {
      const prop = propertiesMap.get(e.propertyId);
      // 객실정비는 진한 회색, 그 밖의 Beds24 차단은 연한 회색 — 예약(숙소 색)과 한눈에 구분.
      const color = e.source === 'maintenance'
        ? '#64748b'
        : e.type === 'block'
        ? '#94a3b8'
        : (prop?.color ?? '#6366f1');
      const end = e.end.substring(0, 10);
      // Blocks don't get cleaning slots
      const cleaning = e.type === 'block' ? undefined : cleaningsIndex.get(`${e.propertyId}_${end}`);
      const cleanerName = cleaning?.cleanerId ? (cleanersMap.get(cleaning.cleanerId)?.name ?? null) : null;
      return {
        id: e.id, propertyId: e.propertyId, color, propName: prop?.name ?? '',
        start: e.start.substring(0, 10), end,
        title: e.title, channelId: e.channelId, source: e.source, description: e.description,
        cleaningId: cleaning?.id ?? null, cleanerId: cleaning?.cleanerId ?? null,
        cleanerName, supplies: cleaning?.supplies ?? null, status: cleaning?.status ?? null,
        type: e.type, tags: e.tags ?? [], originalUid: e.originalUid ?? null,
      };
    });
  }, [events, cleanings, activeProps, propertiesMap, cleanersMap, cleaningsIndex]);

  const activeProperties = useMemo(
    () => properties.filter(p => activeProps.has(p.id)),
    [properties, activeProps],
  );

  const eventsByProp = useMemo(() => {
    const map = new Map<string, ProcessedEvent[]>();
    processedEvents.forEach(e => {
      const list = map.get(e.propertyId) || [];
      list.push(e);
      map.set(e.propertyId, list);
    });
    return map;
  }, [processedEvents]);

  const today = toDateStr(new Date());

  const unassignedCleanings = useMemo(() => {
    const monthStart = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-01`;
    const nextMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    const monthEnd = toDateStr(nextMonth);
    return processedEvents.filter(e =>
      e.end >= today && e.end >= monthStart && e.end < monthEnd && !e.cleanerId
    );
  }, [processedEvents, viewDate, today]);

  const sortedUnassigned = useMemo(
    () => [...unassignedCleanings].sort((a, b) => a.end.localeCompare(b.end)),
    [unassignedCleanings],
  );

  const toggleProp = useCallback((propId: string) => {
    setActiveProps(prev => {
      const n = new Set(prev);
      n.has(propId) ? n.delete(propId) : n.add(propId);
      return n;
    });
  }, []);

  const prevMonth = useCallback(() => {
    setViewDate(d => { const nd = new Date(d); nd.setMonth(nd.getMonth() - 1); return nd; });
  }, []);

  const nextMonth = useCallback(() => {
    setViewDate(d => { const nd = new Date(d); nd.setMonth(nd.getMonth() + 1); return nd; });
  }, []);

  const goToday = useCallback(() => setViewDate(new Date()), []);

  return {
    user, properties, channelMap, cleaners, cleanings, setCleanings,
    events, setEvents,
    loading, activeProps, viewDate, weeks, today,
    processedEvents, activeProperties, eventsByProp,
    unassignedCleanings, sortedUnassigned,
    allSupplyTodos, setAllSupplyTodos,
    toggleProp, prevMonth, nextMonth, goToday,
  };
}
