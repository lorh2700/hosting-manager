'use client';

import { useState } from 'react';
import MobileBookingCalendar from '@/components/MobileBookingCalendar';
import { useCalendarData } from './hooks/useCalendarData';
import { useEventModal } from './hooks/useEventModal';
import { CalendarHeader } from './components/CalendarHeader';
import { PropertyFilter } from './components/PropertyFilter';
import { CalendarGrid } from './components/CalendarGrid';
import { EventDetailPanel } from './components/EventDetailPanel';
import { SupplyTodoList } from './components/SupplyTodoList';

export default function UnifiedCalendarPage() {
  const [mobileView, setMobileView] = useState<'bars' | 'daily'>('bars');
  const data = useCalendarData();
  const modal = useEventModal({
    user: data.user,
    properties: data.properties,
    channelMap: data.channelMap,
    setCleanings: data.setCleanings,
    setAllSupplyTodos: data.setAllSupplyTodos,
    setEvents: data.setEvents,
  });

  if (data.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-t-2 border-[var(--brand)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <CalendarHeader
        viewDate={data.viewDate}
        prevMonth={data.prevMonth}
        nextMonth={data.nextMonth}
        goToday={data.goToday}
        unassignedCleanings={data.unassignedCleanings}
        sortedUnassigned={data.sortedUnassigned}
        openModal={modal.openModal}
      />

      <PropertyFilter
        properties={data.properties}
        activeProps={data.activeProps}
        toggleProp={data.toggleProp}
      />

      <div className="md:hidden">
        <div className="flex gap-2" role="group" aria-label="캘린더 보기 방식">
          {([['bars', '투숙기간 막대'], ['daily', '날짜별 목록']] as const).map(([view, label]) => (
            <button key={view} type="button" aria-pressed={mobileView === view}
              onClick={() => setMobileView(view)}
              className={`min-h-11 flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${mobileView === view ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-600'}`}>
              {label}
            </button>
          ))}
        </div>
        {mobileView === 'bars' && <p className="mt-3 text-xs leading-5 text-stone-500">막대로 체크인부터 체크아웃까지 확인하세요. 좌우로 밀어 날짜를 보고, 막대를 누르면 예약 상세가 열립니다.</p>}
      </div>

      <div className={mobileView === 'daily' ? 'md:hidden' : 'hidden'}><MobileBookingCalendar key={data.viewDate.getTime()} month={data.viewDate} today={data.today}
        events={Array.from(data.eventsByProp.values()).flat().filter(e => data.activeProperties.some(p => p.id === e.propertyId)).map(e => ({ ...e, propertyName: e.propName, cleaningDone: e.status === 'done' }))}
        onEventClick={id => { const event = Array.from(data.eventsByProp.values()).flat().find(e => e.id === id); if (event) modal.openModal(event); }} /></div>
      <div className={mobileView === 'bars' ? 'min-w-0' : 'hidden md:block'}><CalendarGrid
        weeks={data.weeks}
        viewDate={data.viewDate}
        today={data.today}
        activeProperties={data.activeProperties}
        eventsByProp={data.eventsByProp}
        openModal={modal.openModal}
      />

      </div>

      <SupplyTodoList
        allSupplyTodos={data.allSupplyTodos}
        onToggle={modal.handleToggleSupply}
        onDelete={modal.handleDeleteSupply}
      />

      {modal.selectedEvent && (
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
