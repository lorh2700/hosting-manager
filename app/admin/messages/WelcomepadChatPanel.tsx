'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Loader2 } from 'lucide-react';
import {
  isWelcomepadRealtimeConfigured,
  subscribeWelcomepadChat,
} from '@/lib/welcomepadRealtime';

interface WpThread {
  id: number;
  property_key: string;
  propertyName: string;
  propertyId: string | null;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  is_active: boolean;
  last_message_at: string | null;
  created_at: string;
  unread: number;
}

interface WpMessage {
  id: number;
  thread_id: number;
  property_key: string;
  sender: 'guest' | 'host' | 'system';
  body: string;
  lang: string | null;
  read_by_guest_at: string | null;
  read_by_host_at: string | null;
  created_at: string;
  _pending?: boolean;
}

const POLL_MS = 5000;

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

export default function WelcomepadChatPanel() {
  const [threads, setThreads] = useState<WpThread[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<WpMessage[]>([]);
  const [propertyKeys, setPropertyKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const selectedIdRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoSelectedRef = useRef(false);
  selectedIdRef.current = selectedId;

  const realtime = isWelcomepadRealtimeConfigured;

  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch('/api/welcomepad-chat/threads');
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 503) setConfigError(data.error || 'Supabase 설정이 필요합니다.');
        return;
      }
      setConfigError(null);
      const list: WpThread[] = data.threads || [];
      setThreads(list);
      setPropertyKeys(
        Array.from(new Set((data.properties || []).map((p: { welcomepadKey: string }) => p.welcomepadKey))),
      );
      if (!autoSelectedRef.current && list.length > 0) {
        autoSelectedRef.current = true;
        const auto = list.find(t => t.is_active) || list[0];
        setSelectedId(auto.id);
      }
    } catch (err) {
      console.error('[wp-chat] thread fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const markRead = useCallback(async (threadId: number) => {
    try {
      await fetch('/api/welcomepad-chat/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId }),
      });
      setThreads(prev => prev.map(t => (t.id === threadId ? { ...t, unread: 0 } : t)));
    } catch {
      /* non-fatal */
    }
  }, []);

  const fetchMessages = useCallback(
    async (threadId: number, opts: { markReadAfter?: boolean } = {}) => {
      try {
        const res = await fetch(`/api/welcomepad-chat/messages?threadId=${threadId}`);
        const data = await res.json();
        if (!res.ok) return;
        if (selectedIdRef.current !== threadId) return; // switched away mid-flight
        const msgs: WpMessage[] = data.messages || [];
        setMessages(prev => {
          // keep optimistic pending host messages not yet returned by server
          const pending = prev.filter(
            m => m._pending && m.thread_id === threadId && !msgs.some(s => s.body === m.body && s.sender === 'host'),
          );
          return [...msgs, ...pending];
        });
        const hasUnreadGuest = msgs.some(m => m.sender === 'guest' && !m.read_by_host_at);
        if (opts.markReadAfter && hasUnreadGuest) markRead(threadId);
      } catch (err) {
        console.error('[wp-chat] message fetch failed', err);
      }
    },
    [markRead],
  );

  // Initial load
  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // Load messages when a thread is selected
  useEffect(() => {
    if (selectedId == null) return;
    setMessages([]);
    fetchMessages(selectedId, { markReadAfter: true });
  }, [selectedId, fetchMessages]);

  // Realtime doorbell, or polling fallback
  useEffect(() => {
    if (realtime && propertyKeys.length > 0) {
      let raf: ReturnType<typeof setTimeout> | null = null;
      const debouncedThreads = () => {
        if (raf) clearTimeout(raf);
        raf = setTimeout(() => fetchThreads(), 250);
      };
      const unsub = subscribeWelcomepadChat(propertyKeys, evt => {
        debouncedThreads();
        const sel = selectedIdRef.current;
        if (
          sel != null &&
          evt.table === 'welcomepad_messages' &&
          Number((evt.new as { thread_id?: number } | null)?.thread_id) === sel
        ) {
          fetchMessages(sel, { markReadAfter: !document.hidden });
        }
      });
      return () => {
        if (raf) clearTimeout(raf);
        unsub();
      };
    }
    // Polling fallback
    const tick = () => {
      if (document.hidden) return;
      fetchThreads();
      const sel = selectedIdRef.current;
      if (sel != null) fetchMessages(sel, { markReadAfter: true });
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [realtime, propertyKeys, fetchThreads, fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const selectedThread = threads.find(t => t.id === selectedId) || null;

  const send = async () => {
    const thread = selectedThread;
    const text = input.trim();
    if (!text || !thread || sending || !thread.is_active) return;
    setSending(true);
    setSendError(null);
    setInput('');
    const temp: WpMessage = {
      id: -Date.now(),
      thread_id: thread.id,
      property_key: thread.property_key,
      sender: 'host',
      body: text,
      lang: null,
      read_by_guest_at: null,
      read_by_host_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      _pending: true,
    };
    setMessages(prev => [...prev, temp]);
    try {
      const res = await fetch('/api/welcomepad-chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: thread.id, body: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '전송 실패');
      setMessages(prev => {
        const next = prev.map(m => (m.id === temp.id ? (data.message as WpMessage) : m));
        const seen = new Set<number>();
        return next.filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)));
      });
      setThreads(prev =>
        prev.map(t =>
          t.id === thread.id ? { ...t, last_message_at: new Date().toISOString() } : t,
        ),
      );
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== temp.id));
      setInput(text);
      setSendError(err instanceof Error ? err.message : '전송 실패');
    } finally {
      setSending(false);
    }
  };

  if (configError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-stone-400 bg-white border border-stone-200 mt-5 sm:mt-6 p-8 text-center">
        <MessageSquare size={26} strokeWidth={1.5} />
        <p className="text-sm text-stone-600 max-w-md">{configError}</p>
      </div>
    );
  }

  const showMobileThread = selectedId !== null;

  return (
    <div className="flex flex-1 min-h-0 mt-5 sm:mt-6 bg-white border border-stone-200 overflow-hidden">
      {/* Thread list */}
      <div
        className={`${showMobileThread ? 'hidden sm:flex' : 'flex'} w-full sm:w-72 flex-shrink-0 sm:border-r border-stone-200 flex-col`}
      >
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-stone-500">객실 패드 대화</span>
          <span className="flex items-center gap-1.5 text-[12px] text-stone-400">
            <span
              className={`w-1.5 h-1.5 rounded-full ${realtime ? 'bg-emerald-500' : 'bg-stone-300'}`}
            />
            {realtime ? '실시간' : '5초 새로고침'}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 size={16} className="animate-spin text-[var(--brand)]" />
            </div>
          ) : threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-stone-400 px-4 text-center">
              <MessageSquare size={22} strokeWidth={1.5} />
              <p className="text-xs">아직 대화가 없습니다. 게스트가 패드에서 메시지를 보내면 표시됩니다.</p>
            </div>
          ) : (
            threads.map(t => {
              const stay =
                t.check_in && t.check_out
                  ? `${t.check_in} ~ ${t.check_out}`
                  : t.check_in || '';
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-4 py-3.5 border-b border-stone-200 transition-colors ${
                    selectedId === t.id
                      ? 'bg-[var(--brand-tint)]'
                      : 'hover:bg-stone-50 active:bg-stone-100'
                  } ${t.is_active ? '' : 'opacity-70'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-stone-900 truncate">
                        {t.guest_name || '이름 없음'}
                      </p>
                      <p className="text-xs text-stone-500 mt-0.5 truncate">
                        {t.propertyName}
                        <span className="text-stone-400 ml-1">
                          {t.is_active ? '· 현재 게스트' : '· 종료됨'}
                        </span>
                      </p>
                      {stay && (
                        <p className="text-[13px] text-stone-400 mt-1 truncate">{stay}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className="text-[12px] text-stone-400 tabular-nums">
                        {fmtTime(t.last_message_at || t.created_at)}
                      </span>
                      {t.unread > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 bg-[var(--brand)] flex items-center justify-center text-[12px] font-semibold text-white">
                          {t.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Thread detail */}
      {selectedThread ? (
        <div
          className={`${showMobileThread ? 'flex' : 'hidden sm:flex'} flex-1 flex-col min-w-0`}
        >
          <div className="px-4 sm:px-5 py-3.5 border-b border-stone-200 flex items-center gap-3">
            <button
              onClick={() => setSelectedId(null)}
              className="sm:hidden text-stone-500 active:text-stone-900 p-1 -ml-1"
              aria-label="목록으로"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M13 4l-6 6 6 6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-stone-900 truncate">
                {selectedThread.guest_name || '이름 없음'}
              </p>
              <p className="text-xs text-stone-500 truncate">
                {selectedThread.propertyName}
                {selectedThread.check_in && selectedThread.check_out && (
                  <span className="ml-2 text-stone-400">
                    {selectedThread.check_in} → {selectedThread.check_out}
                  </span>
                )}
                <span
                  className={`ml-2 ${selectedThread.is_active ? 'text-emerald-600' : 'text-stone-400'}`}
                >
                  {selectedThread.is_active ? '진행 중' : '종료됨'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 gap-2 text-stone-300">
                <p className="text-xs">아직 메시지가 없습니다.</p>
              </div>
            ) : (
              messages.map(m => {
                if (m.sender === 'system') {
                  return (
                    <div key={m.id} className="flex justify-center">
                      <span className="text-[13px] text-stone-400 bg-stone-50 px-3 py-1">
                        {m.body}
                      </span>
                    </div>
                  );
                }
                const isHost = m.sender === 'host';
                return (
                  <div
                    key={m.id}
                    className={`flex ${isHost ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] sm:max-w-xs px-4 py-2.5 text-[13px] leading-relaxed ${
                        isHost
                          ? `bg-[var(--brand)] text-white ${m._pending ? 'opacity-60' : ''}`
                          : 'bg-stone-100 text-stone-800'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p
                        className={`text-[12px] mt-1 ${isHost ? 'text-white/70' : 'text-stone-400'}`}
                      >
                        {fmtTime(m.created_at)}
                        {isHost && m.read_by_guest_at ? ' · 읽음' : ''}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {sendError && (
            <div className="px-4 pt-2">
              <p className="text-xs text-amber-600">{sendError}</p>
            </div>
          )}
          <div className="px-3 sm:px-4 py-3 sm:py-4 border-t border-stone-200 flex items-end gap-2 sm:gap-3">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={!selectedThread.is_active}
              placeholder={
                selectedThread.is_active
                  ? '메시지를 입력하세요...'
                  : '종료된 대화입니다 (읽기 전용)'
              }
              rows={1}
              className="flex-1 bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 placeholder-stone-400 resize-none outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors disabled:bg-stone-50 disabled:text-stone-400"
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending || !selectedThread.is_active}
              className="w-11 h-11 bg-[var(--brand)] flex items-center justify-center hover:bg-[var(--brand-dark)] active:scale-95 transition-all disabled:opacity-30 flex-shrink-0"
              aria-label="전송"
            >
              <Send size={16} className="text-white" />
            </button>
          </div>
        </div>
      ) : (
        <div className="hidden sm:flex flex-1 flex-col items-center justify-center gap-3 text-stone-400">
          <MessageSquare size={28} strokeWidth={1.5} />
          <p className="text-sm">대화를 선택하세요</p>
          <p className="text-xs text-stone-300">객실 패드에서 보낸 게스트 메시지가 여기 표시됩니다</p>
        </div>
      )}
    </div>
  );
}
