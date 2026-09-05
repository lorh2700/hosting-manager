'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Calendar as CalendarIcon, X, AlertTriangle, MessageSquare, CalendarPlus, Wrench } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { CreateReservationModal } from '@/app/admin/calendar/components/CreateReservationModal';
import { CreateMaintenanceModal } from '@/app/admin/calendar/components/CreateMaintenanceModal';

// FullCalendar bundle (~250KB) is lazy-loaded so the page shell paints first.
const PropertyCalendar = dynamic(() => import('./_components/PropertyCalendar'), {
  ssr: false,
  loading: () => (
    <div className="h-[480px] bg-stone-50 border border-stone-200 animate-pulse" />
  ),
});

interface Property {
  id: string;
  name: string;
  timezone: string;
  ownerId: string;
  beds24PropId?: string;
  beds24RoomId?: string;
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
  const [createOpen, setCreateOpen] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [releasingMaintenance, setReleasingMaintenance] = useState(false);

  const fetchEvents = useCallback(async () => {
    if (!user) return;
    try {
      // 1. Fetch direct bookings
      const bookingsRes = await fetch(`/api/bookings?propertyIds=${id}&status=confirmed`);
      const bookingsData = bookingsRes.ok ? await bookingsRes.json() : [];
      const directEvents = bookingsData.map((d: any) => ({
        id: d.id,
        propertyId: d.propertyId,
        channelId: 'direct',
        title: `${d.name} 예약`,
        start: d.checkIn,
        end: d.checkOut,
        type: 'reservation' as const,
        description: `게스트: ${d.name}\n연락처: ${d.email}\n인원: ${d.guests}명`
      }));

      // 2. Fetch channel events
      const eventsRes = await fetch(`/api/events?propertyIds=${id}`);
      const eventsData = eventsRes.ok ? await eventsRes.json() : [];
      const channelEvents = eventsData.map((d: any) => ({
        id: d.id,
        propertyId: d.propertyId,
        channelId: d.channelId,
        source: d.source,
        title: d.title,
        start: d.startDate || d.start,
        end: d.endDate || d.end,
        type: d.type as 'reservation' | 'block',
        description: d.description,
        originalUid: d.originalUid
      }));

      setEvents([...directEvents, ...channelEvents]);
    } catch (error) {
      console.error('Failed to fetch events', error);
    }
  }, [id, user]);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      try {
        const propRes = await fetch(`/api/properties/${id}`);
        if (!propRes.ok) {
          setLoading(false);
          return;
        }
        const propData = await propRes.json();
        setProperty(propData);

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
      if (property?.beds24PropId) {
        // Beds24 connected property
        setBeds24SyncError(null);
        const beds24Response = await fetch('/api/beds24/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyId: id, beds24PropId: property.beds24PropId })
        });
        const beds24Result = await beds24Response.json();
        if (!beds24Result.success) {
          const errMsg = beds24Result.error || 'Beds24 동기화 실패';
          setBeds24SyncError(errMsg);
          console.error('Beds24 sync failed:', errMsg);
        }
      } else {
        // iCal channel sync
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
        if (!result.success || !result.events?.length) {
          alert('가져온 예약 데이터가 없습니다. 채널 URL을 확인해주세요.');
          return;
        }
      }

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

  const isStayfolioChannel = (channelId: string) =>
    channelId.toLowerCase() === 'stayfolio' || channelId === '스테이폴리오';

  // 객실정비 해제 — Beds24 블랙아웃 취소 + 로컬 이벤트 삭제.
  const handleReleaseMaintenance = async () => {
    if (!selectedEvent?.eventId || releasingMaintenance) return;
    if (!window.confirm('객실정비를 해제할까요?\nBeds24 차단도 함께 풀려 예약을 다시 받을 수 있게 됩니다.')) return;
    setReleasingMaintenance(true);
    try {
      const res = await fetch(`/api/beds24/maintenance?eventId=${selectedEvent.eventId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setSelectedEvent(null);
      fetchEvents();
    } catch (err) {
      alert(`정비 해제에 실패했습니다.\n${err instanceof Error ? err.message : ''}`);
    } finally {
      setReleasingMaintenance(false);
    }
  };

  const filterValidEvents = (evts: ReservationEvent[]) =>
    evts.filter(e => {
      if (!activeChannels.includes(e.channelId)) return false;
      // Beds24 차단(객실정비 포함)은 표시, OTA iCal 차단은 숨김 (통합 캘린더와 같은 규칙)
      if (e.type === 'block' && e.channelId !== 'beds24') return false;
      if (isStayfolioChannel(e.channelId)) {
        const diffMs = new Date(e.end.substring(0, 10)).getTime() - new Date(e.start.substring(0, 10)).getTime();
        if (diffMs <= 24 * 60 * 60 * 1000) return false;
      }
      return true;
    });

  const getSourceColor = (source: string): string => {
    const s = source.toLowerCase();
    if (s === 'maintenance') return '#64748b';
    if (s === 'manual-block') return '#94a3b8';
    if (s.includes('airbnb')) return '#ff5a5f';
    if (s.includes('booking')) return '#003580';
    if (s.includes('expedia')) return '#f4b400';
    if (s.includes('agoda')) return '#5b0099';
    if (s.includes('vrbo')) return '#3b82f6';
    if (s.includes('stayfolio')) return '#14b8a6';
    if (s.includes('direct') || s === '') return '#10b981';
    return '#0ea5e9';
  };

  const getChannelColor = (channelName: string) => {
    switch (channelName) {
      case 'Airbnb': return '#ff5a5f';
      case 'Booking.com': return '#003580';
      case 'Stayfolio':
      case '스테이폴리오':
        return '#14b8a6';
      case 'Direct': return '#6366f1';
      case 'Beds24': return '#0ea5e9';
      default: return '#6366f1';
    }
  };

  const getSourceLabel = (source: string): string => {
    const s = source.toLowerCase();
    if (s === 'maintenance') return '객실정비';
    if (s === 'manual-block') return 'Beds24 차단';
    if (s.includes('airbnb')) return 'Airbnb';
    if (s.includes('booking')) return 'Booking.com';
    if (s.includes('expedia')) return 'Expedia';
    if (s.includes('agoda')) return 'Agoda';
    if (s.includes('vrbo')) return 'VRBO';
    if (s.includes('stayfolio')) return 'Stayfolio';
    if (s.includes('direct') || s === '') return '직접 예약 (Beds24)';
    return source || 'Beds24';
  };

  const calendarEvents = useMemo(() => filterValidEvents(events)
    .map((e) => {
      const channel = channels.find((c) => c.id === e.channelId);
      let channelName: string;
      let color: string;
      if (e.channelId === 'beds24') {
        const src = e.source || '';
        channelName = getSourceLabel(src);
        color = getSourceColor(src);
      } else if (e.channelId === 'direct') {
        channelName = '직접 예약';
        color = getChannelColor('Direct');
      } else {
        channelName = channel?.id || '';
        color = getChannelColor(channelName);
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
          channelName,
          eventId: e.id,
          description: e.description,
          source: e.source,
        },
      };
    }), [events, activeChannels, channels]);

  // Calculate conflicts (double bookings)
  const groupedConflicts = useMemo(() => {
    const toDateStr = (d: string) => d.substring(0, 10);

    const checkableEvents = filterValidEvents(events)
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

  if (loading) return <div className="text-center py-24 text-stone-500 font-light tracking-widest text-[11px]">불러오는 중...</div>;
  if (!property) return <div className="text-center py-24 text-stone-500 font-light tracking-widest text-[11px]">숙소를 찾을 수 없습니다</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col gap-5 md:flex-row md:justify-between md:items-start pb-6 border-b border-stone-200">
        <div>
          <Link href="/admin/properties" className="inline-flex items-center gap-1.5 text-stone-400 hover:text-stone-900 text-[10px] tracking-widest font-medium mb-5 transition-colors">
            <ArrowLeft size={12} /> 숙소 목록
          </Link>
          <h1 className="text-3xl font-light tracking-tight text-stone-900">{property.name}</h1>
          <p className="text-stone-400 mt-1.5 text-xs font-light tracking-widest">{property.timezone}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/book/${id}`}
            target="_blank"
            className="border border-stone-200 text-stone-700 px-4 py-2 text-[11px] tracking-widest font-medium flex items-center gap-2 hover:bg-stone-100 hover:text-stone-900 transition-colors"
          >
            예약 페이지 보기
          </Link>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="border border-stone-200 text-stone-700 px-4 py-2 text-[11px] tracking-widest font-medium flex items-center gap-2 hover:bg-stone-100 hover:text-stone-900 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            {syncing ? '동기화 중...' : '동기화'}
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            title="직접 예약 등록 (Beds24)"
            className="bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white px-4 py-2 text-[11px] tracking-widest font-semibold uppercase flex items-center gap-2 transition-colors"
          >
            <CalendarPlus size={13} />
            예약 등록
          </button>
          {property?.beds24RoomId && (
            <button
              onClick={() => setMaintenanceOpen(true)}
              title="객실정비 차단 등록 (Beds24 블랙아웃)"
              className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 text-[11px] tracking-widest font-semibold uppercase flex items-center gap-2 transition-colors"
            >
              <Wrench size={13} />
              객실정비
            </button>
          )}
        </div>
      </header>

      {/* Sub-menu Tabs */}
      <div className="flex gap-1 bg-stone-50 p-1 border border-stone-200">
        {[
          { href: `/admin/properties/${id}`, label: '캘린더', active: pathname === `/admin/properties/${id}` },
          { href: `/admin/properties/${id}/channels`, label: '채널 연결', active: pathname === `/admin/properties/${id}/channels` },
          { href: `/admin/properties/${id}/settings`, label: '숙소 설정', active: pathname === `/admin/properties/${id}/settings` },
        ].map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 text-center px-4 py-2 text-[11px] tracking-widest font-medium transition-colors ${
              tab.active ? 'bg-[var(--brand)] text-white' : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {groupedConflicts.length > 0 && (
        <div className="border border-red-200 bg-red-50 overflow-hidden mb-2">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-red-100">
            <div className="flex items-center justify-center w-7 h-7 bg-red-100">
              <AlertTriangle size={14} className="text-red-600" strokeWidth={2} />
            </div>
            <span className="text-[11px] font-semibold tracking-widest text-red-600 uppercase">
              더블부킹 경고
            </span>
            <span className="ml-auto text-[10px] font-mono bg-red-100 text-red-700 px-2 py-0.5">
              {groupedConflicts.length}건
            </span>
          </div>
          <div className="divide-y divide-red-100">
            {groupedConflicts.map((c, idx) => (
              <div key={idx} className="flex items-center justify-between px-5 py-3 gap-4">
                <span className="text-[11px] font-mono text-red-600/80 tabular-nums">{c.dateRange}</span>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {c.channels.map((ch) => (
                    <span key={ch} className="text-[10px] tracking-wide bg-red-50 border border-red-200 text-red-700 px-2 py-0.5">
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
          <div className="bg-white border border-stone-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 flex items-center gap-2">
              <CalendarIcon size={13} className="text-stone-400" />
              <span className="text-[10px] font-semibold tracking-widest text-stone-500 uppercase">채널 필터</span>
            </div>
            <div className="p-3 space-y-1">
              {/* Direct */}
              <label className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-stone-100 transition-colors group">
                <input
                  type="checkbox"
                  checked={activeChannels.includes('direct')}
                  onChange={() => toggleChannelFilter('direct')}
                  className="w-3.5 h-3.5 accent-[var(--brand)]"
                />
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getChannelColor('Direct') }} />
                <span className="text-[11px] font-light text-stone-700 group-hover:text-stone-900 transition-colors">직접 예약</span>
              </label>

              {/* Beds24 */}
              {property?.beds24PropId && (
                <div>
                  <label className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-stone-100 transition-colors group">
                    <input
                      type="checkbox"
                      checked={activeChannels.includes('beds24')}
                      onChange={() => toggleChannelFilter('beds24')}
                      className="w-3.5 h-3.5 accent-[var(--brand)]"
                    />
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: beds24SyncError ? '#ef4444' : '#0ea5e9' }} />
                    <span className="text-[11px] font-light text-stone-700 group-hover:text-stone-900 transition-colors">Beds24</span>
                    {beds24SyncError && <span className="ml-auto text-[9px] text-red-600">오류</span>}
                  </label>
                  {beds24SyncError && (
                    <p className="text-[10px] text-red-600/80 px-2 pb-1 leading-relaxed">
                      {beds24SyncError.includes('BEDS24_REFRESH_TOKEN') ? '토큰 미설정' : beds24SyncError}
                    </p>
                  )}
                </div>
              )}

              {/* iCal channels — hidden when Beds24 is connected (Beds24 is the single source) */}
              {property?.beds24PropId ? (
                channels.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-stone-200">
                    <p className="text-[10px] text-stone-300 tracking-wide px-2 pb-1">iCal (Beds24로 통합)</p>
                    {channels.map((channel) => (
                      <div key={channel.id} className="flex items-center gap-3 px-2 py-1.5 opacity-30">
                        <div className="w-3.5 h-3.5" />
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getChannelColor(channel.id) }} />
                        <span className="text-[11px] font-light text-stone-500 line-through">{channel.id}</span>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                channels.map((channel) => (
                  <label key={channel.id} className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-stone-100 transition-colors group">
                    <input
                      type="checkbox"
                      checked={activeChannels.includes(channel.id)}
                      onChange={() => toggleChannelFilter(channel.id)}
                      className="w-3.5 h-3.5 accent-[var(--brand)]"
                    />
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getChannelColor(channel.id) }} />
                    <span className="text-[11px] font-light text-stone-700 group-hover:text-stone-900 transition-colors">{channel.id}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="bg-white border border-stone-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200">
              <span className="text-[10px] font-semibold tracking-widest text-stone-500 uppercase">범례</span>
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
                  <span className="text-stone-500">{label}</span>
                </div>
              ))}
              <div className="flex items-center gap-3 px-2 py-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-slate-500" />
                <span className="text-stone-500">객실정비</span>
              </div>
              <div className="flex items-center gap-3 px-2 py-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-slate-400" />
                <span className="text-stone-500">차단 날짜</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 bg-white border border-stone-200 p-6 overflow-hidden">
          <PropertyCalendar events={calendarEvents} onEventClick={setSelectedEvent} />
        </div>
      </div>

      {selectedEvent && (
        <div
          className="fixed inset-0 bg-stone-950/40 flex items-end sm:items-center justify-center p-4 z-50 backdrop-blur-md"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-white border border-stone-200 max-w-sm w-full overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Color accent bar */}
            <div className="h-1 w-full" style={{ backgroundColor: selectedEvent.color }} />

            <div className="p-5 flex justify-between items-start gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: `${selectedEvent.color}20` }}>
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedEvent.color }} />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-stone-900 text-sm truncate">{selectedEvent.title}</p>
                  <p className="text-[10px] text-stone-500 tracking-wide mt-0.5">
                    {selectedEvent.channelName}{selectedEvent.type === 'block' ? (selectedEvent.source === 'maintenance' ? ' · 정비 중' : ' · 차단됨') : ''}
                  </p>
                </div>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="text-stone-400 hover:text-stone-900 transition-colors flex-shrink-0 mt-0.5">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 pb-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-stone-50 p-3">
                  <p className="text-[9px] tracking-widest text-stone-400 uppercase mb-1.5">체크인</p>
                  <p className="text-sm font-medium text-stone-900 tabular-nums">
                    {selectedEvent.start?.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })}
                  </p>
                </div>
                <div className="bg-stone-50 p-3">
                  <p className="text-[9px] tracking-widest text-stone-400 uppercase mb-1.5">체크아웃</p>
                  <p className="text-sm font-medium text-stone-900 tabular-nums">
                    {selectedEvent.end?.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })}
                  </p>
                </div>
              </div>

              {selectedEvent.description && (
                <div className="bg-stone-50 p-3 max-h-40 overflow-y-auto">
                  <p className="text-[9px] tracking-widest text-stone-400 uppercase mb-2">상세 정보</p>
                  <p className="text-xs text-stone-700 whitespace-pre-wrap leading-relaxed font-light">
                    {selectedEvent.description}
                  </p>
                </div>
              )}

              {selectedEvent.type === 'block' && selectedEvent.source === 'maintenance' && (
                <button
                  onClick={handleReleaseMaintenance}
                  disabled={releasingMaintenance}
                  className="w-full flex items-center justify-center gap-2 border border-slate-300 text-slate-700 hover:bg-slate-50 py-2.5 text-[11px] tracking-widest transition-colors disabled:opacity-40"
                >
                  <Wrench size={13} />
                  {releasingMaintenance ? '해제 중...' : '정비 해제 (Beds24 차단 취소)'}
                </button>
              )}

              {selectedEvent.eventId && selectedEvent.type !== 'block' && (
                <button
                  onClick={() => router.push(`/admin/messages?eventId=${selectedEvent.eventId}&guestName=${encodeURIComponent(selectedEvent.title)}&propertyId=${id}`)}
                  className="w-full flex items-center justify-center gap-2 border border-stone-200 text-stone-700 hover:text-stone-900 hover:border-stone-300 py-2.5 text-[11px] tracking-widest transition-colors"
                >
                  <MessageSquare size={13} />
                  게스트 메시지
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {createOpen && property && (
        <CreateReservationModal
          properties={[{ id: property.id, name: property.name }]}
          defaultPropertyId={property.id}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            fetchEvents();
          }}
        />
      )}

      {maintenanceOpen && property && (
        <CreateMaintenanceModal
          properties={[{ id: property.id, name: property.name }]}
          defaultPropertyId={property.id}
          onClose={() => setMaintenanceOpen(false)}
          onCreated={() => {
            setMaintenanceOpen(false);
            fetchEvents();
          }}
        />
      )}
    </div>
  );
}
