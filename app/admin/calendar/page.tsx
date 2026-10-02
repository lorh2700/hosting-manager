'use client';

import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { useCalendarData } from './hooks/useCalendarData';
import { useEventModal } from './hooks/useEventModal';
import { CalendarHeader } from './components/CalendarHeader';
import { PropertyFilter } from './components/PropertyFilter';
import { CalendarGrid } from './components/CalendarGrid';
import { MobileWeeklyCalendar } from './components/MobileWeeklyCalendar';
import { SupplyTodoList } from './components/SupplyTodoList';

const MonthCalendar = memo(CalendarGrid);
const WeeklyCalendar = memo(MobileWeeklyCalendar);
const MobileBookingCalendar = dynamic(() => import('@/components/MobileBookingCalendar'), { loading: CalendarPlaceholder });
const EventDetailPanel = dynamic(() => import('./components/EventDetailPanel').then(module => module.EventDetailPanel), {
  loading: () => <p role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-stone-900 px-4 py-3 text-sm text-white">예약 상세를 여는 중…</p>,
});

function subscribeViewport(onChange: () => void) {
  const media = window.matchMedia('(max-width: 767px)');
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const mobileSnapshot = () => window.matchMedia('(max-width: 767px)').matches;
const serverSnapshot = () => null;

function CalendarPlaceholder() {
  return <div role="status" aria-live="polite" className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
    <p className="text-sm text-stone-500">예약과 청소 일정을 불러오는 중…</p>
    <div aria-hidden="true" className="grid grid-cols-7 gap-2 motion-safe:animate-pulse">
      {Array.from({ length: 28 }, (_, index) => <span key={index} className="h-12 rounded-lg bg-stone-100" />)}
    </div>
  </div>;
}

export default function UnifiedCalendarPage() {
  const [mobileView, setMobileView] = useState<'weekly' | 'bars' | 'daily'>('weekly');
  // CSS-hidden calendars still build every cell. Mount only the visible view.
  const isMobile = useSyncExternalStore(subscribeViewport, mobileSnapshot, serverSnapshot);
  const data = useCalendarData();
  const modal = useEventModal({
    user: data.user,
    properties: data.properties,
    channelMap: data.channelMap,
    setCleanings: data.setCleanings,
    setAllSupplyTodos: data.setAllSupplyTodos,
    setEvents: data.setEvents,
  });
  const closeModal = modal.closeModal;
  useEffect(() => {
    if (data.loading || data.error) closeModal();
  }, [data.loading, data.error, closeModal]);

  const dailyEvents = useMemo(() => isMobile && mobileView === 'daily'
    ? data.processedEvents.map(event => ({ ...event, propertyName: event.propName, cleaningDone: event.status === 'done' }))
    : [], [isMobile, mobileView, data.processedEvents]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <CalendarHeader
        mobileWeekly={mobileView === 'weekly'}
        viewDate={data.viewDate}
        prevMonth={data.prevMonth}
        nextMonth={data.nextMonth}
        goToday={data.goToday}
        unassignedCleanings={data.loading ? [] : data.unassignedCleanings}
        sortedUnassigned={data.loading ? [] : data.sortedUnassigned}
        openModal={modal.openModal}
      />

      {data.error ? <div role="alert" className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm text-stone-600">{data.error}</p>
        <button type="button" onClick={data.retry} className="min-h-11 rounded-xl bg-stone-900 px-4 text-sm text-white">다시 시도</button>
      </div> : data.loading || isMobile === null ? <CalendarPlaceholder /> : <>
      <PropertyFilter
        properties={data.properties}
        activeProps={data.activeProps}
        toggleProp={data.toggleProp}
      />
      <p className="text-xs text-stone-500">{data.viewDate.getMonth() + 1}월과 달력에 이어지는 앞뒤 날짜의 일정을 함께 표시합니다.</p>

      <div className="md:hidden">
        <div className="flex gap-2" role="group" aria-label="캘린더 보기 방식">
          {([['weekly', '주간'], ['bars', '월간'], ['daily', '날짜별 목록']] as const).map(([view, label]) => (
            <button key={view} type="button" aria-pressed={mobileView === view}
              onClick={() => setMobileView(view)}
              className={`min-h-11 flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${mobileView === view ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-600'}`}>
              {label}
            </button>
          ))}
        </div>
        {mobileView === 'bars' && <p className="mt-3 text-xs leading-5 text-stone-500">막대로 체크인부터 체크아웃까지 확인하세요. 좌우로 밀어 날짜를 보고, 막대를 누르면 예약 상세가 열립니다.</p>}
      </div>

      {isMobile && mobileView === 'weekly' && <WeeklyCalendar
        viewDate={data.viewDate} today={data.today} onDateChange={data.setViewDate}
        properties={data.activeProperties} eventsByProp={data.eventsByProp} channelMap={data.channelMap} openModal={modal.openModal}
      />}

      {isMobile && mobileView === 'daily' && <MobileBookingCalendar key={data.viewDate.getTime()} month={data.viewDate} today={data.today}
        events={dailyEvents}
        onEventClick={id => { const event = data.processedEvents.find(e => e.id === id); if (event) modal.openModal(event); }} />}
      {(!isMobile || mobileView === 'bars') && <div className="min-w-0"><MonthCalendar
        weeks={data.weeks}
        viewDate={data.viewDate}
        today={data.today}
        activeProperties={data.activeProperties}
        eventsByProp={data.eventsByProp}
        openModal={modal.openModal}
      />

      </div>}

      <SupplyTodoList
        allSupplyTodos={data.allSupplyTodos}
        onToggle={modal.handleToggleSupply}
        onDelete={modal.handleDeleteSupply}
      />
      </>}

      {!data.loading && !data.error && modal.selectedEvent && (
        <EventDetailPanel
          selectedEvent={modal.selectedEvent}
          today={data.today}
          cleaners={data.cleaners}
          selectedCleaner={modal.selectedCleaner}
          setSelectedCleaner={modal.setSelectedCleaner}
          cleanerSaving={modal.cleanerSaving}
          completingCleaning={modal.completingCleaning}
          savingTags={modal.savingTags}
          supplyTodos={modal.supplyTodos}
          newSupply={modal.newSupply}
          setNewSupply={modal.setNewSupply}
          modalMessages={modal.modalMessages}
          newMessage={modal.newMessage}
          setNewMessage={modal.setNewMessage}
          sendingMessage={modal.sendingMessage}
          loadingMessages={modal.loadingMessages}
          syncingMessages={modal.syncingMessages}
          unassignedCleanings={data.unassignedCleanings}
          sortedUnassigned={data.sortedUnassigned}
          isLoggedIn={!!data.user}
          onClose={modal.closeModal}
          onSaveCleaner={modal.handleSaveCleaner}
          onDeleteCleaner={modal.handleDeleteCleaner}
          onCompleteCleaning={modal.handleCompleteCleaning}
          onAddSupply={modal.handleAddSupply}
          onToggleSupply={modal.handleToggleSupply}
          onDeleteSupply={modal.handleDeleteSupply}
          onSendMessage={modal.handleSendMessage}
          onSyncMessages={modal.handleSyncMessages}
          onUpdateTags={modal.handleUpdateTags}
          onReservationCancelled={modal.handleReservationCancelled}
          onReleaseMaintenance={modal.handleReleaseMaintenance}
          releasingMaintenance={modal.releasingMaintenance}
          openModal={modal.openModal}
        />
      )}
    </div>
  );
}
