'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { ArrowLeft, RefreshCw, Calendar as CalendarIcon, X, AlertTriangle, MessageSquare } from 'lucide-react';
import { useRouter } from 'next/navigation';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import koLocale from '@fullcalendar/core/locales/ko';
import { doc, getDoc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';

interface Property {
  id: string;
  name: string;
  timezone: string;
  ownerId: string;
  beds24PropId?: string;
}

interface ReservationEvent {
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

export default function CalendarPage() {
  const { id } = useParams() as { id: string };
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const [property, setProperty] = useState<Property | null>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [events, setEvents] = useState<ReservationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [beds24SyncError, setBeds24SyncError] = useState<string | null>(null);
  const [activeChannels, setActiveChannels] = useState<string[]>(['direct']);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);

  const fetchEvents = useCallback(async () => {
    if (!user) return;
    try {
      // 1. Fetch direct bookings
      const qBookings = query(collection(db, 'bookings'), where('propertyId', '==', id), where('status', '==', 'confirmed'));
      const snapshotBookings = await getDocs(qBookings);
      const directEvents = snapshotBookings.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          propertyId: d.propertyId,
          channelId: 'direct',
          title: `${d.name} 예약`,
          start: d.checkIn,
          end: d.checkOut,
          type: 'reservation' as const,
          description: `게스트: ${d.name}\n연락처: ${d.email}\n인원: ${d.guests}명`
        };
      });

      // 2. Fetch channel events
      const qEvents = query(collection(db, 'events'), where('propertyId', '==', id));
      const snapshotEvents = await getDocs(qEvents);
      const channelEvents = snapshotEvents.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          propertyId: d.propertyId,
          channelId: d.channelId,
          source: d.source,
          title: d.title,
          start: d.start,
          end: d.end,
          type: d.type as 'reservation' | 'block',
          description: d.description,
          originalUid: d.originalUid
        };
      });

      setEvents([...directEvents, ...channelEvents]);
    } catch (error) {
      console.error('Failed to fetch events', error);
    }
  }, [id, user]);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      try {
        const propDoc = await getDoc(doc(db, 'properties', id));
        if (!propDoc.exists()) {
          setLoading(false);
          return;
        }

        setProperty({ id: propDoc.id, ...propDoc.data() } as Property);

        const propData = propDoc.data();
        const channelsMap = propData?.channels ?? {};
        const channelsData = Object.entries(channelsMap).map(([name, ch]: [string, any]) => ({ id: name, ...ch }));
        setChannels(channelsData);

        // Add active channels to filter
        const activeIds = channelsData.filter((c: any) => c.isActive).map(c => c.id);
        const beds24Id = propData?.beds24PropId ? ['beds24'] : [];
        setActiveChannels(['direct', ...activeIds, ...beds24Id]);

        await fetchEvents();
      } catch (error) {
        console.error('Error fetching data', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, user, fetchEvents]);

  // Auto sync every 10 minutes
  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const allParsedEvents: any[] = [];

      if (property?.beds24PropId) {
        // Beds24가 연결된 숙소 → Beds24를 단일 소스로 사용 (iCal 중복 방지)
        setBeds24SyncError(null);
        const beds24Response = await fetch('/api/beds24/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyId: id, beds24PropId: property.beds24PropId })
        });
        const beds24Result = await beds24Response.json();
        if (beds24Result.success) {
          allParsedEvents.push(...beds24Result.events);
        } else {
          const errMsg = beds24Result.error || 'Beds24 동기화 실패';
          setBeds24SyncError(errMsg);
          console.error('Beds24 sync failed:', errMsg);
        }
      } else {
        // Beds24 미연결 → iCal 채널 동기화
        const activeChs = channels.filter(c => c.isActive && c.importUrl);
        if (activeChs.length === 0) {
          alert('동기화할 채널이 없습니다.');
          return;
        }
        const response = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyId: id, channels: activeChs })
        });
        const result = await response.json();
        if (result.success) {
          allParsedEvents.push(...result.events);
        }
      }

      if (allParsedEvents.length === 0) {
        alert('가져온 예약 데이터가 없습니다. 채널 URL을 확인해주세요.');
        return;
      }

      // 기존 이벤트 삭제 후 새 이벤트 저장
      const qOldEvents = query(collection(db, 'events'), where('propertyId', '==', id));
      const oldEventsSnapshot = await getDocs(qOldEvents);

      const batch = writeBatch(db);
      oldEventsSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      allParsedEvents.forEach((ev: any) => {
        const newEventRef = doc(collection(db, 'events'));
        batch.set(newEventRef, {
          propertyId: ev.propertyId,
          channelId: ev.channelId,
          source: ev.source || '',
          title: (ev.title || '').substring(0, 199),
          start: ev.start,
          end: ev.end,
          type: ev.type,
          originalUid: (ev.originalUid || '').substring(0, 199),
          description: (ev.description || '').substring(0, 1999),
          createdAt: ev.createdAt
        });
      });

      await batch.commit();
      await fetchEvents();
    } catch (error) {
      console.error('Sync failed', error);
      alert(`동기화에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSyncing(false);
    }
  }, [channels, id, fetchEvents, property]);

  useEffect(() => {
    if (loading || !property) return;

    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        handleSync();
      }
    }, 10 * 60 * 1000); // 10 minutes

    return () => clearInterval(intervalId);
  }, [loading, property, handleSync]);

  const toggleChannelFilter = (channelId: string) => {
    setActiveChannels((prev) =>
      prev.includes(channelId)
        ? prev.filter((id) => id !== channelId)
        : [...prev, channelId]
    );
  };

  const getSourceColor = (source: string, isBlock: boolean): string => {
    if (isBlock) return '#94a3b8';
    const s = source.toLowerCase();
    if (s.includes('airbnb')) return '#ff5a5f';
    if (s.includes('booking')) return '#003580';
    if (s.includes('expedia')) return '#f4b400';
    if (s.includes('agoda')) return '#5b0099';
    if (s.includes('vrbo')) return '#3b82f6';
    if (s.includes('stayfolio')) return '#14b8a6';
    if (s.includes('direct') || s === '') return '#10b981'; // emerald — beds24 direct
    return '#0ea5e9'; // sky — generic beds24
  };

  const getChannelColor = (channelName: string, isBlock: boolean) => {
    if (isBlock) return '#94a3b8';
    switch (channelName) {
      case 'Airbnb': return '#ff5a5f';
      case 'Booking.com': return '#003580';
      case 'Stayfolio':
      case '스테이폴리오':
        return '#14b8a6';
      case 'Direct': return '#6366f1'; // indigo — our direct booking page
      case 'Beds24': return '#0ea5e9';
      default: return '#6366f1';
    }
  };

  const getSourceLabel = (source: string): string => {
    const s = source.toLowerCase();
    if (s.includes('airbnb')) return 'Airbnb';
    if (s.includes('booking')) return 'Booking.com';
    if (s.includes('expedia')) return 'Expedia';
    if (s.includes('agoda')) return 'Agoda';
    if (s.includes('vrbo')) return 'VRBO';
    if (s.includes('stayfolio')) return 'Stayfolio';
    if (s.includes('direct') || s === '') return '직접 예약 (Beds24)';
    return source || 'Beds24';
  };

  const isStayfolioChannel = (channelId: string) =>
    channelId.toLowerCase() === 'stayfolio' || channelId === '스테이폴리오';

  const calendarEvents = useMemo(() => events
    .filter((e) => {
      if (!activeChannels.includes(e.channelId)) return false;
      if (e.type === 'block') return false;
      // Stayfolio 1-day events are cross-channel blocks, not real reservations
      if (isStayfolioChannel(e.channelId)) {
        const diffMs = new Date(e.end.substring(0, 10)).getTime() - new Date(e.start.substring(0, 10)).getTime();
        if (diffMs <= 24 * 60 * 60 * 1000) return false;
      }
      return true;
    })
    .map((e) => {
      const channel = channels.find((c) => c.id === e.channelId);
      let channelName: string;
      let color: string;
      if (e.channelId === 'beds24') {
        const src = e.source || '';
        channelName = getSourceLabel(src);
        color = getSourceColor(src, e.type === 'block');
      } else if (e.channelId === 'direct') {
        channelName = '직접 예약';
        color = getChannelColor('Direct', e.type === 'block');
      } else {
        channelName = channel?.id || '';
        color = getChannelColor(channelName, e.type === 'block');
      }
      return {
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        backgroundColor: color,
        borderColor: color,
        extendedProps: {
          type: e.type,
          channelName: channelName,
          eventId: e.id,
          description: e.description,
        },
      };
    }), [events, activeChannels, channels]);

  // Calculate conflicts (double bookings)
  // Rules:
  // 1. Only check active channels, ignore 'block' events
  // 2. Normalize all dates to YYYY-MM-DD to avoid timezone false positives
  //    (Beds24 returns "2026-05-01", iCal returns "2026-05-01T00:00:00" — different timestamps but same day)
  // 3. Skip if two events share the exact same start+end date — same booking seen from multiple channels
  // 4. Skip checkout=checkin (consecutive bookings, not an overlap)
  const groupedConflicts = useMemo(() => {
    const toDateStr = (d: string) => d.substring(0, 10); // Normalize to YYYY-MM-DD

    const checkableEvents = events
      .filter(e => {
        if (!activeChannels.includes(e.channelId)) return false;
        if (e.type === 'block') return false;
        if (isStayfolioChannel(e.channelId)) {
          const diffMs = new Date(e.end.substring(0, 10)).getTime() - new Date(e.start.substring(0, 10)).getTime();
          if (diffMs <= 24 * 60 * 60 * 1000) return false;
        }
        return true;
      })
      .map(e => ({ ...e, startDate: toDateStr(e.start), endDate: toDateStr(e.end) }));

    const resolveChannelName = (channelId: string) => {
      if (channelId === 'direct') return '직접 예약';
      if (channelId === 'beds24') return 'Beds24';
      return channels.find(ch => ch.id === channelId)?.id || channelId;
    };

    const conflictGroups: Record<string, Set<string>> = {};

    for (let i = 0; i < checkableEvents.length; i++) {
      for (let j = i + 1; j < checkableEvents.length; j++) {
        const e1 = checkableEvents[i];
        const e2 = checkableEvents[j];

        // Skip same booking seen from multiple channels (same date range)
        if (e1.startDate === e2.startDate && e1.endDate === e2.endDate) continue;

        const start1 = new Date(e1.startDate).getTime();
        const end1 = new Date(e1.endDate).getTime();
        const start2 = new Date(e2.startDate).getTime();
        const end2 = new Date(e2.endDate).getTime();

        // Overlap: intervals intersect and checkout != checkin (consecutive is fine)
        const overlaps = start1 < end2 && end1 > start2 && end1 !== start2 && end2 !== start1;
        if (!overlaps) continue;

        const overlapStart = new Date(Math.max(start1, start2)).toISOString().substring(0, 10);
        const overlapEnd = new Date(Math.min(end1, end2)).toISOString().substring(0, 10);
        const dateKey = `${overlapStart} ~ ${overlapEnd}`;

        if (!conflictGroups[dateKey]) conflictGroups[dateKey] = new Set();
        conflictGroups[dateKey].add(resolveChannelName(e1.channelId));
        conflictGroups[dateKey].add(resolveChannelName(e2.channelId));
      }
    }

    return Object.entries(conflictGroups).map(([dateRange, channelSet]) => ({
      dateRange,
      channels: Array.from(channelSet),
    }));
  }, [events, activeChannels, channels]);

  if (loading) return <div className="text-center py-24 text-white/50 font-light tracking-widest text-[11px]">불러오는 중...</div>;
  if (!property) return <div className="text-center py-24 text-white/50 font-light tracking-widest text-[11px]">숙소를 찾을 수 없습니다</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col gap-5 md:flex-row md:justify-between md:items-start pb-6 border-b border-white/8">
        <div>
          <Link href="/admin/properties" className="inline-flex items-center gap-1.5 text-white/30 hover:text-white text-[10px] tracking-widest font-medium mb-5 transition-colors">
            <ArrowLeft size={12} /> 숙소 목록
          </Link>
          <h1 className="text-3xl font-light tracking-tight text-white">{property.name}</h1>
          <p className="text-white/30 mt-1.5 text-xs font-light tracking-widest">{property.timezone}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/book/${id}`}
            target="_blank"
            className="rounded-lg border border-white/10 text-white/60 px-4 py-2 text-[11px] tracking-widest font-medium flex items-center gap-2 hover:bg-white/5 hover:text-white transition-colors"
          >
            예약 페이지 보기
          </Link>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="rounded-lg bg-white text-black px-4 py-2 text-[11px] tracking-widest font-semibold flex items-center gap-2 hover:bg-white/90 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            {syncing ? '동기화 중...' : '동기화'}
          </button>
        </div>
      </header>

      {/* Sub-menu Tabs */}
      <div className="flex gap-1 bg-white/[0.03] rounded-xl p-1 border border-white/8">
        {[
          { href: `/admin/properties/${id}`, label: '캘린더', active: pathname === `/admin/properties/${id}` },
          { href: `/admin/properties/${id}/channels`, label: '채널 연결', active: pathname === `/admin/properties/${id}/channels` },
          { href: `/admin/properties/${id}/settings`, label: '숙소 설정', active: pathname === `/admin/properties/${id}/settings` },
        ].map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 text-center px-4 py-2 rounded-lg text-[11px] tracking-widest font-medium transition-colors ${
              tab.active ? 'bg-white text-black' : 'text-white/40 hover:text-white/70'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {groupedConflicts.length > 0 && (
        <div className="rounded-xl border border-red-500/20 bg-gradient-to-r from-red-950/40 to-red-900/10 overflow-hidden mb-2">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-red-500/10">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-red-500/15">
              <AlertTriangle size={14} className="text-red-400" strokeWidth={2} />
            </div>
            <span className="text-[11px] font-semibold tracking-widest text-red-400 uppercase">
              더블부킹 경고
            </span>
            <span className="ml-auto text-[10px] font-mono bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full">
              {groupedConflicts.length}건
            </span>
          </div>
          <div className="divide-y divide-red-500/10">
            {groupedConflicts.map((c, idx) => (
              <div key={idx} className="flex items-center justify-between px-5 py-3 gap-4">
                <span className="text-[11px] font-mono text-red-300/70 tabular-nums">{c.dateRange}</span>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {c.channels.map((ch) => (
                    <span key={ch} className="text-[10px] tracking-wide bg-red-500/10 border border-red-500/20 text-red-300/80 px-2 py-0.5 rounded-full">
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:w-56 shrink-0 space-y-4">
          <div className="rounded-xl bg-white/[0.03] border border-white/8 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/8 flex items-center gap-2">
              <CalendarIcon size={13} className="text-white/40" />
              <span className="text-[10px] font-semibold tracking-widest text-white/50 uppercase">채널 필터</span>
            </div>
            <div className="p-3 space-y-1">
              {/* Direct */}
              <label className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors group">
                <input
                  type="checkbox"
                  checked={activeChannels.includes('direct')}
                  onChange={() => toggleChannelFilter('direct')}
                  className="w-3.5 h-3.5 accent-white rounded-sm"
                />
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getChannelColor('Direct', false) }} />
                <span className="text-[11px] font-light text-white/60 group-hover:text-white/90 transition-colors">직접 예약</span>
              </label>

              {/* Beds24 */}
              {property?.beds24PropId && (
                <div>
                  <label className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors group">
                    <input
                      type="checkbox"
                      checked={activeChannels.includes('beds24')}
                      onChange={() => toggleChannelFilter('beds24')}
                      className="w-3.5 h-3.5 accent-white rounded-sm"
                    />
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: beds24SyncError ? '#ef4444' : '#0ea5e9' }} />
                    <span className="text-[11px] font-light text-white/60 group-hover:text-white/90 transition-colors">Beds24</span>
                    {beds24SyncError && <span className="ml-auto text-[9px] text-red-400/80">오류</span>}
                  </label>
                  {beds24SyncError && (
                    <p className="text-[10px] text-red-400/70 px-2 pb-1 leading-relaxed">
                      {beds24SyncError.includes('BEDS24_REFRESH_TOKEN') ? '토큰 미설정' : beds24SyncError}
                    </p>
                  )}
                </div>
              )}

              {/* iCal channels — hidden when Beds24 is connected (Beds24 is the single source) */}
              {property?.beds24PropId ? (
                channels.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/8">
                    <p className="text-[10px] text-white/25 tracking-wide px-2 pb-1">iCal (Beds24로 통합)</p>
                    {channels.map((channel) => (
                      <div key={channel.id} className="flex items-center gap-3 px-2 py-1.5 opacity-30">
                        <div className="w-3.5 h-3.5" />
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getChannelColor(channel.id, false) }} />
                        <span className="text-[11px] font-light text-white/50 line-through">{channel.id}</span>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                channels.map((channel) => (
                  <label key={channel.id} className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors group">
                    <input
                      type="checkbox"
                      checked={activeChannels.includes(channel.id)}
                      onChange={() => toggleChannelFilter(channel.id)}
                      className="w-3.5 h-3.5 accent-white rounded-sm"
                    />
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getChannelColor(channel.id, false) }} />
                    <span className="text-[11px] font-light text-white/60 group-hover:text-white/90 transition-colors">{channel.id}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl bg-white/[0.03] border border-white/8 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/8">
              <span className="text-[10px] font-semibold tracking-widest text-white/50 uppercase">범례</span>
            </div>
            <div className="p-3 space-y-1 text-[11px] font-light">
              {(property?.beds24PropId ? [
                { color: '#ff5a5f', label: 'Airbnb' },
                { color: '#003580', label: 'Booking.com' },
                { color: '#f4b400', label: 'Expedia' },
                { color: '#5b0099', label: 'Agoda' },
                { color: '#10b981', label: '직접 예약 (Beds24)' },
                { color: '#0ea5e9', label: 'Beds24 기타' },
              ] : [
                { color: '#ff5a5f', label: 'Airbnb' },
                { color: '#003580', label: 'Booking.com' },
                { color: '#14b8a6', label: 'Stayfolio' },
                { color: '#6366f1', label: '직접 예약' },
              ]).map(({ color, label }) => (
                <div key={label} className="flex items-center gap-3 px-2 py-1.5">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-white/50">{label}</span>
                </div>
              ))}
              <div className="flex items-center gap-3 px-2 py-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-slate-400" />
                <span className="text-white/50">차단 날짜</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/8 p-6 overflow-hidden calendar-dark-theme">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek',
            }}
            buttonText={{
              today: '오늘',
              month: '월',
              week: '주',
              day: '일',
              list: '목록'
            }}
            locales={[koLocale]}
            locale="ko"
            events={calendarEvents}
            height="auto"
            eventClick={(info) => {
              setSelectedEvent({
                title: info.event.title,
                start: info.event.start,
                end: info.event.end,
                type: info.event.extendedProps.type,
                channelName: info.event.extendedProps.channelName,
                description: info.event.extendedProps.description,
                color: info.event.backgroundColor,
                eventId: info.event.extendedProps.eventId,
              });
            }}
            eventContent={(eventInfo) => {
              return (
                <div className="p-1.5 overflow-hidden text-[10px] tracking-wider truncate">
                  <div className="font-semibold">{eventInfo.event.title}</div>
                  <div className="opacity-70 font-light">{eventInfo.event.extendedProps.type === 'block' ? '차단' : '예약'}</div>
                </div>
              );
            }}
          />
        </div>
      </div>

      {selectedEvent && (
        <div
          className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center p-4 z-50 backdrop-blur-md"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-[#0e0e0e] border border-white/10 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Color accent bar */}
            <div className="h-1 w-full" style={{ backgroundColor: selectedEvent.color }} />

            <div className="p-5 flex justify-between items-start gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: `${selectedEvent.color}20` }}>
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedEvent.color }} />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-white text-sm truncate">{selectedEvent.title}</p>
                  <p className="text-[10px] text-white/40 tracking-wide mt-0.5">
                    {selectedEvent.channelName}{selectedEvent.type === 'block' ? ' · 차단됨' : ''}
                  </p>
                </div>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="text-white/30 hover:text-white transition-colors flex-shrink-0 mt-0.5">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 pb-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/[0.04] rounded-xl p-3">
                  <p className="text-[9px] tracking-widest text-white/30 uppercase mb-1.5">체크인</p>
                  <p className="text-sm font-medium text-white tabular-nums">
                    {selectedEvent.start?.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })}
                  </p>
                </div>
                <div className="bg-white/[0.04] rounded-xl p-3">
                  <p className="text-[9px] tracking-widest text-white/30 uppercase mb-1.5">체크아웃</p>
                  <p className="text-sm font-medium text-white tabular-nums">
                    {selectedEvent.end?.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })}
                  </p>
                </div>
              </div>

              {selectedEvent.description && (
                <div className="bg-white/[0.04] rounded-xl p-3 max-h-40 overflow-y-auto">
                  <p className="text-[9px] tracking-widest text-white/30 uppercase mb-2">상세 정보</p>
                  <p className="text-xs text-white/60 whitespace-pre-wrap leading-relaxed font-light">
                    {selectedEvent.description}
                  </p>
                </div>
              )}

              {selectedEvent.eventId && (
                <button
                  onClick={() => router.push(`/admin/messages?eventId=${selectedEvent.eventId}&guestName=${encodeURIComponent(selectedEvent.title)}&propertyId=${id}`)}
                  className="w-full flex items-center justify-center gap-2 border border-white/10 text-white/60 hover:text-white hover:border-white/30 rounded-xl py-2.5 text-[11px] tracking-widest transition-colors"
                >
                  <MessageSquare size={13} />
                  게스트 메시지
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
