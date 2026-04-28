'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  type Property, type Cleaning, type ProcessedEvent,
  type SelectedEvent, type SupplyTodo, type ModalMessage, type GlobalSupplyTodo,
  type RawEvent,
  getChannelLabel, getRoomReadyMessage,
} from '../types';

interface UseEventModalParams {
  user: { id: string; email: string } | null;
  properties: Property[];
  channelMap: Record<string, string>;
  setCleanings: React.Dispatch<React.SetStateAction<Cleaning[]>>;
  setAllSupplyTodos: React.Dispatch<React.SetStateAction<GlobalSupplyTodo[]>>;
  setEvents: React.Dispatch<React.SetStateAction<RawEvent[]>>;
}

export function useEventModal({
  user, properties, channelMap,
  setCleanings, setAllSupplyTodos, setEvents,
}: UseEventModalParams) {
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null);
  const [selectedCleaner, setSelectedCleaner] = useState('');
  const [cleanerSaving, setCleanerSaving] = useState(false);
  const [completingCleaning, setCompletingCleaning] = useState(false);
  const [savingTags, setSavingTags] = useState(false);

  // Supply state
  const [supplyTodos, setSupplyTodos] = useState<SupplyTodo[]>([]);
  const [newSupply, setNewSupply] = useState('');

  // Message state
  const [modalMessages, setModalMessages] = useState<ModalMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [syncingMessages, setSyncingMessages] = useState(false);

  const openModal = useCallback((e: ProcessedEvent) => {
    setSelectedEvent({
      eventId: e.id,
      title: e.title, start: e.start, end: e.end,
      propertyId: e.propertyId, propertyName: e.propName, propertyColor: e.color,
      channelId: e.channelId, channelLabel: getChannelLabel(e.channelId, e.source, channelMap),
      description: e.description,
      cleaningId: e.cleaningId, cleanerId: e.cleanerId, cleanerName: e.cleanerName,
      supplies: e.supplies, status: e.status,
      type: e.type, tags: e.tags ?? [], originalUid: e.originalUid ?? null,
      source: e.source,
    });
    setSelectedCleaner(e.cleanerId ?? '');
  }, [channelMap]);

  const closeModal = useCallback(() => setSelectedEvent(null), []);

  const handleSaveCleaner = async () => {
    if (!selectedEvent) return;
    setCleanerSaving(true);
    const checkoutDate = selectedEvent.end.substring(0, 10);
    const cleanerIdToSave = selectedCleaner || null;
    try {
      if (selectedEvent.cleaningId) {
        const res = await fetch('/api/cleanings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedEvent.cleaningId, cleanerId: cleanerIdToSave }),
        });
        if (!res.ok) throw new Error('업데이트 실패');
        setCleanings(prev => prev.map(c =>
          c.id === selectedEvent.cleaningId ? { ...c, cleanerId: cleanerIdToSave } : c
        ));
      } else {
        const res = await fetch('/api/cleanings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyId: selectedEvent.propertyId, date: checkoutDate, cleanerId: cleanerIdToSave, status: 'pending' }),
        });
        if (!res.ok) throw new Error('생성 실패');
        const newCleaning = await res.json();
        setCleanings(prev => [...prev, {
          id: newCleaning.id, propertyId: selectedEvent.propertyId,
          date: checkoutDate, cleanerId: cleanerIdToSave, status: 'pending' as const,
        }]);
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
      await fetch(`/api/cleanings?id=${selectedEvent.cleaningId}`, { method: 'DELETE' });
      setCleanings(prev => prev.filter(c => c.id !== selectedEvent.cleaningId));
      setSelectedEvent(prev => prev ? { ...prev, cleaningId: null, cleanerId: null, cleanerName: null, supplies: null, status: null } : null);
      setSelectedCleaner('');
    } catch (err) { console.error(err); alert('삭제에 실패했습니다.'); }
    finally { setCleanerSaving(false); }
  };

  const handleCompleteCleaning = async () => {
    if (!selectedEvent?.cleaningId) return;
    setCompletingCleaning(true);
    try {
      await fetch('/api/cleanings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedEvent.cleaningId, status: 'done' }),
      });
      setCleanings(prev => prev.map(c =>
        c.id === selectedEvent.cleaningId ? { ...c, status: 'done' as const } : c
      ));
      if (selectedEvent.channelId === 'beds24' && user) {
        try {
          await fetch('/api/beds24/messages/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventId: selectedEvent.eventId, propertyId: selectedEvent.propertyId,
              text: getRoomReadyMessage(properties, selectedEvent.propertyId),
            }),
          });
        } catch { /* 메시지 전송 실패해도 정비 완료는 유지 */ }
      }
      setSelectedEvent(prev => prev ? { ...prev, status: 'done' } : null);
    } catch (err) { console.error(err); alert('정비 완료 처리에 실패했습니다.'); }
    finally { setCompletingCleaning(false); }
  };

  // Supply TODO handlers
  const handleAddSupply = async () => {
    if (!selectedEvent || !newSupply.trim()) return;
    const checkoutDate = selectedEvent.end.substring(0, 10);
    const now = new Date().toISOString();
    try {
      const res = await fetch('/api/supply-todos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: selectedEvent.propertyId, date: checkoutDate, text: newSupply.trim(), done: false }),
      });
      const created = await res.json();
      const newItem = { id: created.id, text: newSupply.trim(), done: false };
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
      await fetch('/api/supply-todos', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: todoId, done }) });
      if (updateLocal) setSupplyTodos(prev => prev.map(t => t.id === todoId ? { ...t, done } : t));
      setAllSupplyTodos(prev => prev.map(t => t.id === todoId ? { ...t, done } : t));
    } catch (err) { console.error(err); }
  };

  const handleDeleteSupply = async (todoId: string, updateLocal = true) => {
    try {
      await fetch(`/api/supply-todos?id=${todoId}`, { method: 'DELETE' });
      if (updateLocal) setSupplyTodos(prev => prev.filter(t => t.id !== todoId));
      setAllSupplyTodos(prev => prev.filter(t => t.id !== todoId));
    } catch (err) { console.error(err); alert('삭제에 실패했습니다.'); }
  };

  // Load supply TODOs when modal opens
  useEffect(() => {
    if (!selectedEvent) { setSupplyTodos([]); setNewSupply(''); return; }
    const checkoutDate = selectedEvent.end.substring(0, 10);
    const loadSupplies = async () => {
      try {
        const res = await fetch(`/api/supply-todos?propertyId=${selectedEvent.propertyId}`);
        const data = res.ok ? await res.json() : [];
        setSupplyTodos(data.filter((d: { date: string }) => d.date === checkoutDate).map((d: { id: string; text: string; done: boolean }) => ({ id: d.id, text: d.text, done: d.done })));
      } catch { setSupplyTodos([]); }
    };
    loadSupplies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent?.eventId]);

  // Fetch messages when modal opens + poll (only for beds24 channels)
  useEffect(() => {
    if (!selectedEvent?.eventId) { setModalMessages([]); setNewMessage(''); return; }
    const isBeds24 = selectedEvent.channelId === 'beds24';
    setLoadingMessages(true);
    let cancelled = false;
    const fetchMessages = async () => {
      try {
        const res = await fetch(`/api/messages?eventId=${selectedEvent.eventId}`);
        if (!res.ok || cancelled) { if (!cancelled) setModalMessages([]); return; }
        const data = await res.json();
        const msgs: ModalMessage[] = (Array.isArray(data) ? data : []).map((m: Record<string, unknown>) => ({
          id: m.id as string, text: m.text as string, sender: m.sender as string,
          createdAt: (m.createdAt as string) || '', source: m.source as string | undefined,
          beds24MessageType: m.beds24MessageType as string | undefined,
          deliveryStatus: m.deliveryStatus as string | undefined, read: m.read as boolean | undefined,
        }));
        msgs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (!cancelled) setModalMessages(msgs);
        const unreadIds = msgs.filter(m => m.sender === 'guest' && !m.read).map(m => m.id);
        if (unreadIds.length > 0) {
          fetch('/api/messages', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: unreadIds, read: true }) });
        }
      } catch { if (!cancelled) setModalMessages([]); }
      finally { if (!cancelled) setLoadingMessages(false); }
    };
    fetchMessages();
    // Only poll for beds24 channels (external messages)
    const interval = isBeds24 ? setInterval(fetchMessages, 15000) : null;
    return () => { cancelled = true; if (interval) clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent?.eventId]);

  const handleSendMessage = async () => {
    if (!selectedEvent?.eventId || !newMessage.trim() || sendingMessage || !user) return;
    setSendingMessage(true);
    try {
      const res = await fetch('/api/beds24/messages/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: selectedEvent.eventId, propertyId: selectedEvent.propertyId, text: newMessage.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '전송 실패');
      setNewMessage('');
    } catch { alert('메시지 전송에 실패했습니다.'); }
    finally { setSendingMessage(false); }
  };

  const handleSyncMessages = async () => {
    if (syncingMessages || !selectedEvent?.propertyId || !user) return;
    setSyncingMessages(true);
    try {
      await fetch('/api/beds24/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyIds: [selectedEvent.propertyId] }),
      });
    } catch { /* polling will pick up new messages */ }
    finally { setSyncingMessages(false); }
  };

  const handleUpdateTags = async (tags: string[]) => {
    if (!selectedEvent) return;
    setSavingTags(true);
    try {
      const res = await fetch(`/api/admin/calendar/events/${selectedEvent.eventId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      });
      if (!res.ok) throw new Error('태그 저장 실패');
      const updated = await res.json();
      const saved: string[] = Array.isArray(updated.tags) ? updated.tags : tags;
      setSelectedEvent(prev => prev ? { ...prev, tags: saved } : null);
      setEvents(prev => prev.map(e => e.id === selectedEvent.eventId ? { ...e, tags: saved } : e));
    } catch (err) {
      console.error(err);
      alert('태그 저장에 실패했습니다.');
    } finally {
      setSavingTags(false);
    }
  };

  return {
    selectedEvent, selectedCleaner, setSelectedCleaner,
    cleanerSaving, completingCleaning,
    savingTags,
    supplyTodos, newSupply, setNewSupply,
    modalMessages, newMessage, setNewMessage,
    sendingMessage, loadingMessages, syncingMessages,
    openModal, closeModal,
    handleSaveCleaner, handleDeleteCleaner, handleCompleteCleaning,
    handleAddSupply, handleToggleSupply, handleDeleteSupply,
    handleSendMessage, handleSyncMessages,
    handleUpdateTags,
  };
}
