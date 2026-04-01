'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  collection, query, where, getDocs, addDoc, orderBy,
  onSnapshot, doc, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';
import { MessageSquare, Send, ChevronRight } from 'lucide-react';

interface Message {
  id: string;
  eventId: string;
  propertyId: string;
  guestName: string;
  text: string;
  sender: 'host' | 'guest';
  createdAt: string;
  read: boolean;
}

interface Conversation {
  eventId: string;
  propertyId: string;
  guestName: string;
  propertyName: string;
  lastMessage: string;
  lastMessageAt: string;
  unread: number;
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  // Load properties once
  useEffect(() => {
    if (!user) return;
    const loadProperties = async () => {
      const q = query(collection(db, 'properties'), where('ownerId', '==', user.uid));
      const snap = await getDocs(q);
      const map: Record<string, string> = {};
      snap.docs.forEach(d => { map[d.id] = (d.data() as { name: string }).name; });
      setProperties(map);
    };
    loadProperties();
  }, [user]);

  // Load all conversations (grouped by eventId)
  const loadConversations = useCallback(async () => {
    if (!user || Object.keys(properties).length === 0) return;
    setLoading(true);
    try {
      const propertyIds = Object.keys(properties);
      // Firestore 'in' supports up to 30 items
      const chunks: string[][] = [];
      for (let i = 0; i < propertyIds.length; i += 30) {
        chunks.push(propertyIds.slice(i, i + 30));
      }
      const allMessages: Message[] = [];
      for (const chunk of chunks) {
        const q = query(collection(db, 'messages'), where('propertyId', 'in', chunk));
        const snap = await getDocs(q);
        snap.docs.forEach(d => {
          allMessages.push({ id: d.id, ...d.data() } as Message);
        });
      }

      // Group by eventId
      const grouped: Record<string, Message[]> = {};
      allMessages.forEach(m => {
        if (!grouped[m.eventId]) grouped[m.eventId] = [];
        grouped[m.eventId].push(m);
      });

      const convs: Conversation[] = Object.entries(grouped).map(([eventId, msgs]) => {
        const sorted = [...msgs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const last = sorted[sorted.length - 1];
        const unread = msgs.filter(m => m.sender === 'guest' && !m.read).length;
        return {
          eventId,
          propertyId: last.propertyId,
          guestName: last.guestName,
          propertyName: properties[last.propertyId] || last.propertyId,
          lastMessage: last.text,
          lastMessageAt: last.createdAt,
          unread,
        };
      });

      convs.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      setConversations(convs);

      // Auto-select from URL params or most recent
      if (initialEventId && !selectedConv) {
        const existing = convs.find(c => c.eventId === initialEventId);
        if (existing) {
          setSelectedConv(existing);
        } else if (initialGuestName && initialPropertyId) {
          // Start new conversation
          const newConv: Conversation = {
            eventId: initialEventId,
            propertyId: initialPropertyId,
            guestName: decodeURIComponent(initialGuestName),
            propertyName: properties[initialPropertyId] || initialPropertyId,
            lastMessage: '',
            lastMessageAt: new Date().toISOString(),
            unread: 0,
          };
          setSelectedConv(newConv);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [user, properties, initialEventId, initialGuestName, initialPropertyId, selectedConv]);

  useEffect(() => {
    if (Object.keys(properties).length > 0) {
      loadConversations();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties]);

  // Subscribe to messages for selected conversation
  useEffect(() => {
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    if (!selectedConv) return;

    const q = query(
      collection(db, 'messages'),
      where('eventId', '==', selectedConv.eventId),
      orderBy('createdAt', 'asc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Message));
      setMessages(msgs);
      // Mark guest messages as read
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.sender === 'guest' && !data.read) {
          updateDoc(doc(db, 'messages', d.id), { read: true });
        }
      });
    });
    unsubRef.current = unsub;
    return () => unsub();
  }, [selectedConv]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!inputText.trim() || !selectedConv || sending) return;
    setSending(true);
    const text = inputText.trim();
    setInputText('');
    try {
      await addDoc(collection(db, 'messages'), {
        eventId: selectedConv.eventId,
        propertyId: selectedConv.propertyId,
        guestName: selectedConv.guestName,
        text,
        sender: 'host',
        createdAt: new Date().toISOString(),
        read: true,
      });
      // Update conversation in list
      setConversations(prev => prev.map(c =>
        c.eventId === selectedConv.eventId
          ? { ...c, lastMessage: text, lastMessageAt: new Date().toISOString() }
          : c
      ));
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

  if (!user) return null;

  return (
    <div className="max-w-5xl mx-auto h-[calc(100vh-7rem)] flex flex-col gap-0">
      <header className="pb-6 border-b border-white/8 flex-shrink-0">
        <h1 className="text-3xl font-light tracking-tight text-white">메시지</h1>
        <p className="text-white/30 mt-1.5 text-xs font-light tracking-widest">게스트와의 대화를 관리합니다</p>
      </header>

      <div className="flex flex-1 min-h-0 mt-6 border border-white/8 rounded-xl overflow-hidden">
        {/* Conversation list */}
        <div className="w-72 flex-shrink-0 border-r border-white/8 flex flex-col">
          <div className="px-4 py-3 border-b border-white/8">
            <span className="text-[10px] font-semibold tracking-widest text-white/40 uppercase">대화 목록</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-24">
                <div className="w-5 h-5 border-t border-white/30 rounded-full animate-spin" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-white/20">
                <MessageSquare size={24} />
                <p className="text-[11px] tracking-wide">대화 없음</p>
              </div>
            ) : (
              conversations.map(conv => (
                <button
                  key={conv.eventId}
                  onClick={() => setSelectedConv(conv)}
                  className={`w-full text-left px-4 py-4 border-b border-white/5 hover:bg-white/5 transition-colors ${
                    selectedConv?.eventId === conv.eventId ? 'bg-white/8' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-white truncate">{conv.guestName}</p>
                      <p className="text-[10px] text-white/35 tracking-wide mt-0.5">{conv.propertyName}</p>
                      <p className="text-[11px] text-white/40 mt-1.5 truncate">{conv.lastMessage || '메시지 없음'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className="text-[9px] text-white/25 tabular-nums">{formatTime(conv.lastMessageAt)}</span>
                      {conv.unread > 0 && (
                        <span className="w-4 h-4 bg-indigo-500 rounded-full flex items-center justify-center text-[9px] font-semibold text-white">
                          {conv.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
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
                    <p className="text-[12px] font-medium text-white truncate">{decodeURIComponent(initialGuestName)}</p>
                    <p className="text-[10px] text-indigo-400 tracking-wide mt-0.5">새 대화 시작</p>
                  </div>
                  <ChevronRight size={12} className="text-white/20" />
                </div>
              </button>
            )}
          </div>
        </div>

        {/* Message thread */}
        {selectedConv ? (
          <div className="flex-1 flex flex-col min-w-0">
            {/* Thread header */}
            <div className="px-5 py-3.5 border-b border-white/8 flex items-center gap-3">
              <div>
                <p className="text-[12px] font-medium text-white">{selectedConv.guestName}</p>
                <p className="text-[10px] text-white/35 tracking-wide">{selectedConv.propertyName}</p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-24 gap-2 text-white/15">
                  <p className="text-[11px] tracking-wide">아직 메시지가 없습니다. 게스트에게 먼저 메시지를 보내보세요.</p>
                </div>
              )}
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === 'host' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs px-4 py-2.5 rounded-2xl text-[12px] leading-relaxed ${
                      msg.sender === 'host'
                        ? 'bg-white text-black rounded-tr-sm'
                        : 'bg-white/[0.07] text-white/80 rounded-tl-sm'
                    }`}
                  >
                    <p>{msg.text}</p>
                    <p className={`text-[9px] mt-1 ${msg.sender === 'host' ? 'text-black/40' : 'text-white/25'}`}>
                      {formatTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-4 border-t border-white/8 flex items-end gap-3">
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
                rows={2}
                className="flex-1 bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-[12px] text-white placeholder-white/20 resize-none outline-none focus:border-white/25 transition-colors"
              />
              <button
                onClick={sendMessage}
                disabled={!inputText.trim() || sending}
                className="w-10 h-10 bg-white rounded-xl flex items-center justify-center hover:bg-white/90 transition-colors disabled:opacity-30 flex-shrink-0"
              >
                <Send size={14} className="text-black" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/15">
            <MessageSquare size={32} />
            <p className="text-[12px] tracking-wide">대화를 선택하세요</p>
            <p className="text-[11px]">캘린더에서 예약을 클릭해 메시지를 시작할 수 있습니다</p>
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
