'use client';

import { useState } from 'react';
import { useCalendarData } from './hooks/useCalendarData';
import { useEventModal } from './hooks/useEventModal';
import { CalendarHeader } from './components/CalendarHeader';
import { PropertyFilter } from './components/PropertyFilter';
import { CalendarGrid } from './components/CalendarGrid';
import { EventDetailPanel } from './components/EventDetailPanel';
import { SupplyTodoList } from './components/SupplyTodoList';
import { CreateReservationModal } from './components/CreateReservationModal';
import type { RawEvent } from './types';

export default function UnifiedCalendarPage() {
  const data = useCalendarData();
  const [reservationModalOpen, setReservationModalOpen] = useState(false);
  const modal = useEventModal({
    user: data.user,
    properties: data.properties,
    channelMap: data.channelMap,
    setCleanings: data.setCleanings,
    setAllSupplyTodos: data.setAllSupplyTodos,
    setEvents: data.setEvents,
  });

  const handleReservationCreated = (ev: RawEvent) => {
    data.setEvents(prev => [...prev, ev]);
    setReservationModalOpen(false);
  };

  if (data.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-t-2 border-white rounded-full animate-spin" />
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
        onCreateReservation={() => setReservationModalOpen(true)}
      />

      <PropertyFilter
        properties={data.properties}
        activeProps={data.activeProps}
        toggleProp={data.toggleProp}
      />

      <CalendarGrid
        weeks={data.weeks}
        viewDate={data.viewDate}
        today={data.today}
        activeProperties={data.activeProperties}
        eventsByProp={data.eventsByProp}
        openModal={modal.openModal}
      />

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
          cancellingEvent={modal.cancellingEvent}
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
          onCancelEvent={modal.handleCancelBeds24Event}
          openModal={modal.openModal}
        />
      )}

      {reservationModalOpen && (
        <CreateReservationModal
          properties={data.properties}
          onClose={() => setReservationModalOpen(false)}
          onCreated={handleReservationCreated}
        />
      )}
    </div>
  );
}
