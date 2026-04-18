'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { MessageSquare, Send, ChevronRight, RefreshCw, Loader2 } from 'lucide-react';

const PAGE_SIZE = 20;

interface Message {
  id: string;
  eventId: string;
  propertyId: string;
  guestName: string;
  text: string;
  sender: 'host' | 'guest';
  createdAt: string;
  read: boolean;
  source?: string;             // 'beds24' | undefined (local)
  beds24MessageType?: string;  // 'guest' | 'host' | 'internalNote' | 'system'
}

interface EventInfo {
  id: string;
  propertyId: string;
  title: string;
  start: string;
  end: string;
  description?: string;
}

interface Conversation {
  eventId: string;
  propertyId: string;
  guestName: string;
  propertyName: string;
  lastMessage: string;
  lastMessageAt: string;
  unread: number;
  eventDescription?: string;
  checkIn?: string;
  checkOut?: string;
}

function MessagesContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const initialEventId = searchParams.get('eventId');
  const initialGuestName = searchParams.get('guestName');
  const initialPropertyId = searchParams.get('propertyId');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [properties, setProperties] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const selectedEventIdRef = useRef<string | null>(null);

  // Load properties once
  useEffect(() => {
    if (!user) return;
    const loadProperties = async () => {
      const res = await fetch('/api/properties');
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, string> = {};
      data.forEach((p: any) => { map[p.id] = p.name; });
      setProperties(map);
    };
    loadProperties();
  }, [user]);

  // Load a page of conversations from server (infinite scroll)
  const loadPage = useCallback(async (offset: number, replace: boolean) => {
    if (!user) return;
    if (replace) setLoading(true); else setLoadingMore(true);
    try {
      const res = await fetch(`/api/conversations?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!res.ok) return;
      const data = await res.json();
      const page: Conversation[] = data.conversations || [];
      setHasMore(!!data.hasMore);
      setConversations(prev => {
        if (replace) return page;
        const existing = new Set(prev.map(c => c.eventId));
        return [...prev, ...page.filter(c => !existing.has(c.eventId))];
      });

      // Auto-select from URL params (only on initial load)
      if (replace && initialEventId && !selectedEventIdRef.current) {
        const existing = page.find(c => c.eventId === initialEventId);
        if (existing) {
          selectedEventIdRef.current = existing.eventId;
          setSelectedConv(existing);
        } else if (initialGuestName && initialPropertyId) {
          selectedEventIdRef.current = initialEventId;
          setSelectedConv({
            eventId: initialEventId,
            propertyId: initialPropertyId,
            guestName: decodeURIComponent(initialGuestName),
            propertyName: properties[initialPropertyId] || initialPropertyId,
            lastMessage: '',
            lastMessageAt: new Date().toISOString(),
            unread: 0,
          });
        }
      }
    } finally {
      if (replace) setLoading(false); else setLoadingMore(false);
    }
  }, [user, initialEventId, initialGuestName, initialPropertyId, properties]);

  const loadConversations = useCallback(() => loadPage(0, true), [loadPage]);

  useEffect(() => {
    if (!user) return;
    loadPage(0, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Infinite scroll: observe sentinel
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore || loading || loadingMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        loadPage(conversations.length, false);
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, conversations.length, loadPage]);

  // Poll messages for selected conversation (replaces onSnapshot)
  const fetchMessages = useCallback(async () => {
    if (!selectedConv) return;
    try {
      const res = await fetch(`/api/messages?eventId=${selectedConv.eventId}`);
      if (!res.ok) return;
      const msgs: Message[] = await res.json();
      msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setMessages(msgs);

      // Mark guest messages as read
      const unreadIds = msgs.filter(m => m.sender === 'guest' && !m.read).map(m => m.id);
      if (unreadIds.length > 0) {
        await fetch('/api/messages', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: unreadIds, read: true }),
        });
        // Update conversation list to reflect read status
        setConversations(prev => prev.map(c =>
          c.eventId === selectedConv.eventId ? { ...c, unread: 0 } : c
        ));
      }
    } catch (err) {
      console.error('Failed to fetch messages', err);
    }
  }, [selectedConv]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!selectedConv) return;

    // Initial fetch
    fetchMessages();

    // Poll every 10 seconds (reduced from 5s), pause when tab is hidden
    const startPolling = () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        if (!document.hidden) fetchMessages();
      }, 10000);
    };
    startPolling();

    const handleVisibility = () => {
      if (!document.hidden) fetchMessages(); // refresh immediately on tab focus
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [selectedConv, fetchMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const [sendError, setSendError] = useState<string | null>(null);

  const sendMessage = async () => {
    if (!inputText.trim() || !selectedConv || sending || !user) return;
    setSending(true);
    setSendError(null);
    const text = inputText.trim();
    setInputText('');
    try {
      const res = await fetch('/api/beds24/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: selectedConv.eventId,
          propertyId: selectedConv.propertyId,
          text,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '전송 실패');
      if (data.deliveryStatus === 'failed') {
        setSendError('Beds24 발송 실패 — 메모로 저장됨');
      } else if (data.deliveryStatus === 'local_only') {
        setSendError(null); // local memo is expected for direct bookings
      }
      // Refresh messages immediately
      await fetchMessages();
      // Update conversation in list
      setConversations(prev => prev.map(c =>
        c.eventId === selectedConv.eventId
          ? { ...c, lastMessage: text, lastMessageAt: new Date().toISOString() }
          : c
      ));
    } catch (err) {
      setSendError(err instanceof Error ? err.message : '전송 실패');
      setInputText(text); // restore text on failure
    } finally {
      setSending(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return '어제';
    if (diffDays < 7) return `${diffDays}일 전`;
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  // Sync Beds24 messages
  const syncBeds24Messages = async () => {
    if (syncing || !user) return;
    const propertyIds = Object.keys(properties);
    if (propertyIds.length === 0) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/beds24/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyIds }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(data.synced > 0 ? `${data.synced}건 동기화 완료` : '새 메시지 없음');
        if (data.synced > 0) loadConversations();
      } else {
        setSyncResult(`오류: ${data.error}`);
      }
    } catch {
      setSyncResult('동기화 실패');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 4000);
    }
  };

  // On mobile, show either list or thread
  const showMobileThread = selectedConv !== null;

  if (!user) return null;

  return (
    <div className="max-w-5xl mx-auto h-[calc(100vh-7rem)] sm:h-[calc(100vh-7rem)] flex flex-col gap-0">
      <header className="pb-4 sm:pb-6 border-b border-white/8 flex-shrink-0 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-white">메시지</h1>
          <p className="text-white/30 mt-1.5 text-xs font-light tracking-widest hidden sm:block">게스트와의 대화를 관리합니다</p>
        </div>
        <div className="flex items-center gap-3">
          {syncResult && (
            <span className="text-[11px] text-white/50 tracking-wide hidden sm:inline">{syncResult}</span>
          )}
          <button
            onClick={syncBeds24Messages}
            disabled={syncing}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 text-[11px] tracking-widest font-medium text-white/60 border border-white/10 hover:border-white/25 hover:text-white rounded-lg transition-colors disabled:opacity-40"
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{syncing ? '동기화 중...' : 'Beds24 동기화'}</span>
            <span className="sm:hidden">{syncing ? '...' : '동기화'}</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 mt-4 sm:mt-6 border border-white/8 rounded-xl overflow-hidden">
        {/* Conversation list — hidden on mobile when a thread is open */}
        <div className={`${showMobileThread ? 'hidden sm:flex' : 'flex'} w-full sm:w-72 flex-shrink-0 sm:border-r border-white/8 flex-col`}>
          <div className="px-4 py-3 border-b border-white/8">
            <span className="text-[11px] font-semibold tracking-widest text-white/40 uppercase">대화 목록</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-24">
                <div className="w-5 h-5 border-t border-white/30 rounded-full animate-spin" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-white/20">
                <MessageSquare size={24} />
                <p className="text-xs tracking-wide">대화 없음</p>
              </div>
            ) : (
              conversations.map(conv => (
                <button
                  key={conv.eventId}
                  onClick={() => setSelectedConv(conv)}
                  className={`w-full text-left px-4 py-4 border-b border-white/5 hover:bg-white/5 active:bg-white/8 transition-colors ${
                    selectedConv?.eventId === conv.eventId ? 'bg-white/8' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">{conv.guestName}</p>
                      <p className="text-[11px] text-white/35 tracking-wide mt-0.5">
                        {conv.propertyName}
                        {conv.checkIn && <span className="text-white/20 ml-1">{conv.checkIn}</span>}
                      </p>
                      <p className="text-xs text-white/40 mt-1.5 truncate">{conv.lastMessage || '메시지 없음'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className="text-[10px] text-white/25 tabular-nums">{formatTime(conv.lastMessageAt)}</span>
                      {conv.unread > 0 && (
                        <span className="w-5 h-5 bg-indigo-500 rounded-full flex items-center justify-center text-[10px] font-semibold text-white">
                          {conv.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}

            {!loading && hasMore && (
              <div ref={loadMoreRef} className="flex items-center justify-center py-4">
                {loadingMore ? (
                  <Loader2 size={16} className="animate-spin text-white/40" />
                ) : (
                  <span className="text-[10px] text-white/20 tracking-widest">스크롤하여 더 보기</span>
                )}
              </div>
            )}

            {/* Start new conversation from URL params when no existing conv */}
            {!loading && initialEventId && initialGuestName && !conversations.find(c => c.eventId === initialEventId) && (
              <button
                onClick={() => {
                  if (initialPropertyId) {
                    setSelectedConv({
                      eventId: initialEventId,
                      propertyId: initialPropertyId,
                      guestName: decodeURIComponent(initialGuestName),
                      propertyName: properties[initialPropertyId] || initialPropertyId,
                      lastMessage: '',
                      lastMessageAt: new Date().toISOString(),
                      unread: 0,
                    });
                  }
                }}
                className="w-full text-left px-4 py-4 border-b border-white/5 bg-white/[0.02] hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{decodeURIComponent(initialGuestName)}</p>
                    <p className="text-[11px] text-indigo-400 tracking-wide mt-0.5">새 대화 시작</p>
                  </div>
                  <ChevronRight size={14} className="text-white/20" />
                </div>
              </button>
            )}
          </div>
        </div>

        {/* Message thread — full screen on mobile */}
        {selectedConv ? (
          <div className={`${showMobileThread ? 'flex' : 'hidden sm:flex'} flex-1 flex-col min-w-0`}>
            {/* Thread header */}
            <div className="px-4 sm:px-5 py-3.5 border-b border-white/8 flex items-center gap-3">
              {/* Mobile back button */}
              <button
                onClick={() => setSelectedConv(null)}
                className="sm:hidden text-white/50 active:text-white p-1 -ml-1"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white truncate">{selectedConv.guestName}</p>
                <p className="text-[11px] text-white/35 tracking-wide truncate">
                  {selectedConv.propertyName}
                  {selectedConv.checkIn && selectedConv.checkOut && (
                    <span className="ml-2 text-white/25">{selectedConv.checkIn} → {selectedConv.checkOut}</span>
                  )}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
              {/* Event description as initial context */}
              {selectedConv.eventDescription && (() => {
                const filtered = selectedConv.eventDescription
                  .split('\n')
                  .filter(line => !line.trimStart().startsWith('금액'))
                  .join('\n')
                  .trim();
                return filtered ? (
                  <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl px-4 py-3 mb-2">
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">예약 정보</p>
                    <p className="text-[13px] text-white/50 whitespace-pre-line leading-relaxed">{filtered}</p>
                  </div>
                ) : null;
              })()}

              {messages.length === 0 && !selectedConv.eventDescription && (
                <div className="flex flex-col items-center justify-center h-24 gap-2 text-white/15">
                  <p className="text-xs tracking-wide">아직 메시지가 없습니다. 메모를 추가해보세요.</p>
                </div>
              )}
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === 'host' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] sm:max-w-xs px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
                      msg.sender === 'host'
                        ? 'bg-white text-black rounded-tr-sm'
                        : msg.source === 'beds24'
                          ? 'bg-indigo-500/15 border border-indigo-500/20 text-white/80 rounded-tl-sm'
                          : 'bg-white/[0.07] text-white/80 rounded-tl-sm'
                    }`}
                  >
                    {msg.source === 'beds24' && (
                      <p className={`text-[10px] font-medium mb-1 ${
                        msg.sender === 'host' ? 'text-black/30' : 'text-indigo-400/70'
                      }`}>
                        Beds24 · {msg.beds24MessageType || msg.sender}
                      </p>
                    )}
                    <p>{msg.text}</p>
                    <p className={`text-[10px] mt-1 ${msg.sender === 'host' ? 'text-black/40' : 'text-white/25'}`}>
                      {formatTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            {sendError && (
              <div className="px-4 pt-2">
                <p className="text-[11px] text-amber-400/80 tracking-wide">{sendError}</p>
              </div>
            )}
            <div className="px-3 sm:px-4 py-3 sm:py-4 border-t border-white/8 flex items-end gap-2 sm:gap-3 mb-safe">
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="메시지를 입력하세요..."
                rows={1}
                className="flex-1 bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 resize-none outline-none focus:border-white/25 transition-colors"
              />
              <button
                onClick={sendMessage}
                disabled={!inputText.trim() || sending}
                className="w-11 h-11 bg-white rounded-xl flex items-center justify-center hover:bg-white/90 active:scale-95 transition-all disabled:opacity-30 flex-shrink-0"
              >
                <Send size={16} className="text-black" />
              </button>
            </div>
          </div>
        ) : (
          <div className="hidden sm:flex flex-1 flex-col items-center justify-center gap-3 text-white/15">
            <MessageSquare size={32} />
            <p className="text-sm tracking-wide">대화를 선택하세요</p>
            <p className="text-xs">캘린더에서 예약을 클릭해 메시지를 시작할 수 있습니다</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="text-center py-24 text-white/50 font-light tracking-widest text-[11px]">불러오는 중...</div>}>
      <MessagesContent />
    </Suspense>
  );
}
