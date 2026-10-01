'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { MessageSquare, Send, ChevronRight, ChevronLeft, RefreshCw, Loader2, Check, CircleAlert, StickyNote } from 'lucide-react';
import WelcomepadChatPanel from './WelcomepadChatPanel';
import InquiryAutomationPanel from './InquiryAutomationPanel';
import { SkeletonList, Skeleton } from '@/components/ui';
import { useRefetchOnReturn } from '@/lib/hooks/useRefetchOnReturn';
import { messageDeliveryPresentation, type ReplyTarget, type DeliveryPresentation } from '@/lib/message-presentation';
import styles from './messages.module.css';

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
  automated?: boolean;
  deliveryStatus?: string;
  type?: string;
  source?: string;             // 'beds24' | undefined (local)
  beds24MessageType?: string;  // 'guest' | 'host' | 'internalNote' | 'system'
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

  const [channel, setChannel] = useState<'beds24' | 'inroom'>('beds24');
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
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [targetError, setTargetError] = useState(false);
  const [targetRevision, setTargetRevision] = useState(0);
  const [sendNotice, setSendNotice] = useState<DeliveryPresentation | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const selectedEventIdRef = useRef<string | null>(null);
  const activeEventIdRef = useRef<string | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const draftsRef = useRef<Record<string, string>>({});

  const updateDraft = (text: string) => {
    const eventId = activeEventIdRef.current;
    if (eventId) draftsRef.current[eventId] = text;
    setInputText(text);
  };

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
    void loadProperties().catch(() => setSyncResult('숙소 정보를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.'));
  }, [user]);

  // Load a page of conversations from server (infinite scroll)
  const loadPage = useCallback(async (offset: number, replace: boolean) => {
    if (!user) return;
    if (replace) setLoading(true); else setLoadingMore(true);
    try {
      const res = await fetch(`/api/conversations?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!res.ok) throw new Error('대화 목록을 불러오지 못했습니다. 다시 확인해 주세요.');
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
    } catch (err) {
      setSyncResult(err instanceof Error ? err.message : '대화 목록 조회 실패');
    } finally {
      if (replace) setLoading(false); else setLoadingMore(false);
    }
  }, [user, initialEventId, initialGuestName, initialPropertyId, properties]);

  const loadConversations = useCallback(() => loadPage(0, true), [loadPage]);
  // 탭에 돌아오면 대화 목록을 다시 불러온다 (스레드는 아래 폴링이 따로 갱신).
  useRefetchOnReturn(loadConversations, { minIntervalMs: 30_000 });

  useEffect(() => {
    if (!user) return;
    loadPage(0, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Infinite scroll: observe sentinel
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore || loading || loadingMore || search || unreadOnly) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        loadPage(conversations.length, false);
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, conversations.length, loadPage, search, unreadOnly]);

  useEffect(() => {
    const eventId = selectedConv?.eventId ?? null;
    activeEventIdRef.current = eventId;
    lastMessageIdRef.current = null;
    setMessages([]);
    setInputText(eventId ? draftsRef.current[eventId] || '' : '');
    setSendError(null);
    setSendNotice(null);
    setThreadError(null);
    setThreadLoading(!!eventId);
  }, [selectedConv?.eventId]);

  useEffect(() => {
    const eventId = selectedConv?.eventId;
    const controller = new AbortController();
    setReplyTarget(null);
    setTargetError(false);
    if (!eventId) return;
    void fetch(`/api/conversations/${encodeURIComponent(eventId)}/reply-target`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('답장할 곳을 확인하지 못했습니다.');
        const target: ReplyTarget = await response.json();
        if (!controller.signal.aborted) setReplyTarget(target);
      })
      .catch(() => { if (!controller.signal.aborted) setTargetError(true); });
    return () => controller.abort();
  }, [selectedConv?.eventId, targetRevision]);

  // Poll messages for selected conversation (replaces onSnapshot)
  const fetchMessages = useCallback(async () => {
    if (!selectedConv) return;
    try {
      const res = await fetch(`/api/messages?eventId=${encodeURIComponent(selectedConv.eventId)}`);
      if (!res.ok) throw new Error('메시지를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.');
      const msgs: Message[] = await res.json();
      msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (activeEventIdRef.current !== selectedConv.eventId) return;
      setMessages(msgs);
      setThreadError(null);

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
      if (activeEventIdRef.current === selectedConv.eventId) setThreadError(err instanceof Error ? err.message : '메시지 조회 실패');
    } finally {
      if (activeEventIdRef.current === selectedConv.eventId) setThreadLoading(false);
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
    const latestId = messages[messages.length - 1]?.id;
    if (latestId && latestId !== lastMessageIdRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: lastMessageIdRef.current ? 'smooth' : 'instant', block: 'nearest' });
      lastMessageIdRef.current = latestId;
    }
  }, [messages]);

  const [sendError, setSendError] = useState<string | null>(null);

  const sendMessage = async () => {
    if (!inputText.trim() || !selectedConv || !replyTarget || sending || !user) return;
    const sendingEventId = selectedConv.eventId;
    setSending(true);
    setSendError(null);
    setSendNotice(null);
    const text = inputText.trim();
    draftsRef.current[sendingEventId] = '';
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
      if (activeEventIdRef.current === sendingEventId) {
        setSendNotice(messageDeliveryPresentation({ sender: 'host', deliveryStatus: data.deliveryStatus }));
      }
      // Refresh messages immediately
      if (activeEventIdRef.current === sendingEventId) await fetchMessages();
      // Update conversation in list
      setConversations(prev => prev.map(c =>
        c.eventId === selectedConv.eventId
          ? { ...c, lastMessage: text, lastMessageAt: new Date().toISOString() }
          : c
      ));
    } catch (err) {
      // Keep unsent drafts with their reservation, including when the user changed threads.
      const restoreDraft = !draftsRef.current[sendingEventId];
      if (restoreDraft) draftsRef.current[sendingEventId] = text;
      if (activeEventIdRef.current === sendingEventId) {
        setSendError(err instanceof Error ? err.message : '전송 실패');
        if (restoreDraft) setInputText(text);
      }
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
  const visibleConversations = conversations.filter(conv =>
    (!unreadOnly || conv.unread > 0) && `${conv.guestName} ${conv.propertyName}`.toLowerCase().includes(search.trim().toLowerCase())
  );

  if (!user) return null;

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <h1>메시지</h1>
          <p className={styles.subtitle}>답장할 플랫폼과 접수 상태를 확인하며 대화하세요.</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.channelTabs} aria-label="메시지 종류">
            <button
              type="button"
              onClick={() => setChannel('beds24')}
              aria-pressed={channel === 'beds24'}
            >
              예약 메시지
            </button>
            <button
              type="button"
              onClick={() => setChannel('inroom')}
              aria-pressed={channel === 'inroom'}
            >
              객실 패드
            </button>
          </div>
          {channel === 'beds24' && (
            <>
              {syncResult && (
                <span role="status" className={styles.syncResult}>{syncResult}</span>
              )}
              <button
                type="button"
                onClick={syncBeds24Messages}
                disabled={syncing}
                className={styles.refresh}
              >
                <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} aria-hidden="true" />
                <span>{syncing ? '동기화 중…' : '동기화'}</span>
              </button>
            </>
          )}
        </div>
      </header>

      {channel === 'inroom' ? (
        <WelcomepadChatPanel />
      ) : (
      <div className={styles.panel}>
        {/* Conversation list */}
        <div className={`${styles.list} ${showMobileThread ? styles.mobileHidden : ''}`}>
          <div className={styles.listHead}>
            <p className={styles.listTitle}>대화 목록 <span>불러온 대화 {conversations.length}개</span></p>
            <input className={styles.search} aria-label="현재 대화 목록 검색" placeholder="현재 목록에서 이름·숙소 찾기" value={search} onChange={event => setSearch(event.target.value)} />
            <div className={styles.filters} aria-label="대화 필터">
              <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>전체</button>
              <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>읽지 않음</button>
            </div>
          </div>
          <div className={styles.listBody}>
            {loading && conversations.length === 0 ? (
              <div className="p-3">
                <SkeletonList count={5} rows={1} />
              </div>
            ) : visibleConversations.length === 0 ? (
              <div className={styles.emptyList}>
                <MessageSquare size={22} strokeWidth={1.5} />
                <p>{search || unreadOnly ? '현재 목록에 조건에 맞는 대화가 없습니다.' : '아직 대화가 없습니다.'}</p>
              </div>
            ) : (
              visibleConversations.map(conv => (
                <button
                  type="button"
                  key={conv.eventId}
                  onClick={() => setSelectedConv(conv)}
                  className={styles.conversation}
                  aria-pressed={selectedConv?.eventId === conv.eventId}
                >
                  <div className={styles.conversationTop}>
                    <div className={styles.conversationInfo}>
                      <p className={styles.guestName}>{conv.guestName}</p>
                      <p className={styles.conversationMeta}>
                        {conv.propertyName}
                        {conv.checkIn && <span className="text-stone-400 ml-1">{conv.checkIn}</span>}
                      </p>
                      <p className={styles.lastMessage}>{conv.lastMessage || '메시지 없음'}</p>
                    </div>
                    <div className={styles.conversationCount}>
                      <span>{formatTime(conv.lastMessageAt)}</span>
                      {conv.unread > 0 && (
                        <span className={styles.unread} aria-label={`읽지 않은 메시지 ${conv.unread}개`}>
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
                  <Loader2 size={14} className="animate-spin text-stone-500" />
                ) : search || unreadOnly ? (
                  <button type="button" className={styles.refresh} onClick={() => void loadPage(conversations.length, false)}>이전 대화 20개 더 불러오기</button>
                ) : (
                  <span className="text-[12px] text-stone-400">스크롤하여 더 보기</span>
                )}
              </div>
            )}

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
                className={styles.conversation}
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-900 truncate">{decodeURIComponent(initialGuestName)}</p>
                    <p className="text-xs text-[var(--brand-dark)] mt-0.5">새 대화 시작</p>
                  </div>
                  <ChevronRight size={14} className="text-stone-400" />
                </div>
              </button>
            )}
          </div>
        </div>

        {/* Message thread */}
        {selectedConv ? (
          <div className={styles.thread}>
            <div className={styles.threadHead}>
              <button
                type="button"
                onClick={() => setSelectedConv(null)}
                className={styles.back}
                aria-label="대화 목록으로 돌아가기"
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
              <div className="min-w-0 flex-1">
                <p className={styles.threadHeading}>{selectedConv.guestName}</p>
                <p className={styles.threadMeta}>
                  {selectedConv.propertyName}
                  {selectedConv.checkIn && selectedConv.checkOut && (
                    <span className="ml-2">{selectedConv.checkIn} → {selectedConv.checkOut}</span>
                  )}
                </p>
              </div>
            </div>

            <div className={styles.threadBody} aria-busy={threadLoading}>
              <div className={styles.automation}><InquiryAutomationPanel key={selectedConv.eventId} eventId={selectedConv.eventId} revision={messages.length} onUseDraft={updateDraft} /></div>
              {selectedConv.eventDescription && (() => {
                const filtered = selectedConv.eventDescription
                  .split('\n')
                  .filter(line => !line.trimStart().startsWith('금액'))
                  .join('\n')
                  .trim();
                return filtered ? (
                  <details className={styles.reservationInfo}>
                    <summary>예약 정보 보기</summary>
                    <p>{filtered}</p>
                  </details>
                ) : null;
              })()}

              {threadLoading && <div className={styles.threadLoading} role="status" aria-label="메시지 불러오는 중"><Skeleton className="h-20 w-3/4" /><Skeleton className="h-24 w-3/4 ml-auto" /><Skeleton className="h-16 w-1/2" /></div>}
              {threadError && <p role="alert" className={styles.error}>{threadError} <button type="button" className={styles.refresh} onClick={() => void fetchMessages()}>다시 불러오기</button></p>}
              {!threadLoading && !threadError && messages.length === 0 && (
                <p className={styles.emptyList}>아직 메시지가 없습니다. 아래에서 답장할 곳을 확인하고 작성하세요.</p>
              )}
              {messages.map(msg => {
                const isHost = msg.sender === 'host';
                const isBeds24 = msg.source === 'beds24';
                const delivery = messageDeliveryPresentation(msg);
                const isMemo = delivery?.label === '내부 메모';
                return (
                  <div
                    key={msg.id}
                    className={`${styles.messageRow} ${isHost ? styles.hostRow : ''}`}
                  >
                    <div
                      className={`${styles.bubble} ${isMemo ? styles.memoBubble : isHost ? styles.hostBubble : ''}`}
                    >
                      {isBeds24 && (
                        <p className={styles.messageKind}>
                          {msg.beds24MessageType === 'internalNote' ? 'Beds24 내부 메모' : isHost ? '예약 메시지 기록' : '게스트 메시지'}
                        </p>
                      )}
                      {msg.automated && <p className={styles.messageKind}>GPT 자동답변</p>}
                      <p className={styles.messageText}>{msg.text}</p>
                      <p className={styles.messageFooter}>
                        <span>{formatTime(msg.createdAt)}</span>
                        {delivery && <span className={styles.delivery} data-tone={delivery.tone}>
                          {isMemo ? <StickyNote size={12} aria-hidden="true" /> : delivery.tone === 'success' ? <Check size={12} aria-hidden="true" /> : delivery.tone === 'warning' ? <CircleAlert size={12} aria-hidden="true" /> : null}
                          {delivery.label}
                        </span>}
                      </p>
                      {delivery && <p className={styles.deliveryDetail}>{delivery.detail}</p>}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            <div className={styles.composer}>
              <div className={styles.replyDestination}>
                <span>답장할 곳</span>
                <strong>{replyTarget?.label || (targetError ? '예약의 연락 경로를 확인하지 못했습니다.' : '예약의 연락 경로 확인 중…')}</strong>
                {targetError && <button type="button" className={styles.refresh} onClick={() => setTargetRevision(value => value + 1)}>다시 확인</button>}
                {replyTarget?.isBeds24 && <small>Beds24를 통해 접수하며, 플랫폼 전달 상태는 별도 확인이 필요합니다.</small>}
              </div>
              {sendError && <p role="alert" className={styles.error}>{sendError}</p>}
              {sendNotice && <p role="status" className={styles.notice} data-tone={sendNotice.tone}>{sendNotice.label} · {sendNotice.detail}</p>}
              <div className={styles.composerRow}>
              <textarea
                aria-label={replyTarget?.isBeds24 ? '게스트에게 보낼 답장' : '대화 내용 작성'}
                value={inputText}
                onChange={e => updateDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={replyTarget && !replyTarget.isBeds24 ? '내부 메모를 작성하세요. 게스트에게 발송되지 않습니다.' : '게스트에게 보낼 답장을 작성하세요.'}
                rows={2}
                className={styles.input}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!inputText.trim() || sending || !replyTarget}
                className={styles.send}
              >
                {sending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                <span>{sending ? '접수 중…' : replyTarget && !replyTarget.isBeds24 ? '메모 저장' : '답장 보내기'}</span>
              </button>
              </div>
            </div>
          </div>
        ) : (
          <div className={`${styles.emptyThread} ${styles.mobileHidden}`}>
            <MessageSquare size={28} strokeWidth={1.5} />
            <p>대화를 선택하세요</p>
            <small>예약 달력에서 예약을 선택해 새 대화를 시작할 수도 있습니다.</small>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <SkeletonList count={5} rows={1} />
      </div>
    }>
      <MessagesContent />
    </Suspense>
  );
}
