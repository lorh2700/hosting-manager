'use client';

import { ChevronLeft, ChevronRight, X, Save, Trash2, Send, CheckCircle, RefreshCw } from 'lucide-react';
import type { SelectedEvent, ProcessedEvent, Cleaner, SupplyTodo, ModalMessage } from '../types';

interface EventDetailPanelProps {
  selectedEvent: SelectedEvent;
  today: string;
  cleaners: Cleaner[];
  selectedCleaner: string;
  setSelectedCleaner: (id: string) => void;
  cleanerSaving: boolean;
  completingCleaning: boolean;
  supplyTodos: SupplyTodo[];
  newSupply: string;
  setNewSupply: (v: string) => void;
  modalMessages: ModalMessage[];
  newMessage: string;
  setNewMessage: (v: string) => void;
  sendingMessage: boolean;
  loadingMessages: boolean;
  syncingMessages: boolean;
  unassignedCleanings: ProcessedEvent[];
  sortedUnassigned: ProcessedEvent[];
  isLoggedIn: boolean;
  onClose: () => void;
  onSaveCleaner: () => void;
  onDeleteCleaner: () => void;
  onCompleteCleaning: () => void;
  onAddSupply: () => void;
  onToggleSupply: (id: string, done: boolean) => void;
  onDeleteSupply: (id: string) => void;
  onSendMessage: () => void;
  onSyncMessages: () => void;
  openModal: (e: ProcessedEvent) => void;
}

export function EventDetailPanel({
  selectedEvent, today, cleaners, selectedCleaner, setSelectedCleaner,
  cleanerSaving, completingCleaning,
  supplyTodos, newSupply, setNewSupply,
  modalMessages, newMessage, setNewMessage,
  sendingMessage, loadingMessages, syncingMessages,
  unassignedCleanings, sortedUnassigned, isLoggedIn,
  onClose, onSaveCleaner, onDeleteCleaner, onCompleteCleaning,
  onAddSupply, onToggleSupply, onDeleteSupply,
  onSendMessage, onSyncMessages, openModal,
}: EventDetailPanelProps) {
  const nights = Math.round(
    (new Date(selectedEvent.end).getTime() - new Date(selectedEvent.start).getTime()) / 86400000,
  );

  const filteredDescription = selectedEvent.description
    ?.split('\n')
    .filter(line => !line.trimStart().startsWith('금액'))
    .join('\n')
    .trim();

  // Pull the guest phone out of the description (synced as "연락처: …")
  // so we can suggest the last 4 digits as a door password. If unavailable
  // — or the number is too short — show "없음".
  const suggestedPassword = (() => {
    const phoneLine = selectedEvent.description
      ?.split('\n')
      .map(l => l.trim())
      .find(l => l.startsWith('연락처:') || l.toLowerCase().startsWith('phone:'));
    if (!phoneLine) return '없음';
    const digits = phoneLine.replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : '없음';
  })();

  const isCheckinDay = selectedEvent.start.substring(0, 10) === today;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#161616] border-l border-white/10 w-full max-w-md p-6 space-y-5 h-full overflow-y-auto animate-slide-in-right" onClick={e => e.stopPropagation()}>

        {/* Unassigned navigation */}
        {unassignedCleanings.length > 0 && !selectedEvent.cleanerId && (
          <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            <span className="text-[10px] text-amber-300/80 tracking-wide">
              미지정 {(() => {
                const idx = sortedUnassigned.findIndex(e => e.id === selectedEvent.eventId);
                return `${idx + 1}/${sortedUnassigned.length}`;
              })()}
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  const idx = sortedUnassigned.findIndex(e => e.id === selectedEvent.eventId);
                  const prev = sortedUnassigned[(idx - 1 + sortedUnassigned.length) % sortedUnassigned.length];
                  if (prev) openModal(prev);
                }}
                className="px-2 py-1 text-[10px] text-amber-300/60 border border-amber-500/20 rounded hover:bg-amber-500/15 transition-colors"
              >
                <ChevronLeft size={12} />
              </button>
              <button
                onClick={() => {
                  const idx = sortedUnassigned.findIndex(e => e.id === selectedEvent.eventId);
                  const next = sortedUnassigned[(idx + 1) % sortedUnassigned.length];
                  if (next) openModal(next);
                }}
                className="px-2 py-1 text-[10px] text-amber-300/60 border border-amber-500/20 rounded hover:bg-amber-500/15 transition-colors"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: selectedEvent.propertyColor }} />
            <div>
              <p className="text-[10px] text-white/40 tracking-widest font-medium">{selectedEvent.propertyName}</p>
              <h3 className="text-white font-light text-lg leading-snug mt-0.5">{selectedEvent.title}</h3>
            </div>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors shrink-0 mt-1">
            <X size={16} />
          </button>
        </div>

        {/* Info */}
        <div className="space-y-2.5 bg-white/[0.03] rounded-xl px-4 py-3.5">
          <div className="flex justify-between items-center">
            <span className="text-[10px] tracking-widest text-white/40">채널</span>
            <span className="text-white/80 text-[11px]">{selectedEvent.channelLabel}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[10px] tracking-widest text-white/40">체크인</span>
            <span className="text-white/70 text-[11px] font-mono">{selectedEvent.start}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[10px] tracking-widest text-white/40">체크아웃</span>
            <span className="text-white/70 text-[11px] font-mono">{selectedEvent.end}</span>
          </div>
          {nights > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-[10px] tracking-widest text-white/40">숙박</span>
              <span className="text-white/70 text-[11px]">{nights}박 {nights + 1}일</span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-[10px] tracking-widest text-white/40">추천 비밀번호</span>
            <span className={`text-[11px] font-mono ${suggestedPassword === '없음' ? 'text-white/30' : 'text-white/80'}`}>
              {suggestedPassword}
            </span>
          </div>
          {filteredDescription && (
            <div className="pt-2.5 mt-1 border-t border-white/[0.06]">
              <p className="text-[10px] tracking-widest text-white/30 mb-1.5">예약 메모</p>
              <p className="text-white/50 text-[11px] font-light whitespace-pre-line leading-relaxed">{filteredDescription}</p>
            </div>
          )}
        </div>

        {/* Cleaner Assignment */}
        <div className="border-t border-white/[0.08] pt-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] tracking-widest text-white/40 font-medium">청소 담당자</p>
            {selectedEvent.cleaningId && (
              <button onClick={onDeleteCleaner} disabled={cleanerSaving}
                className="text-[10px] text-white/30 hover:text-red-400 transition-colors disabled:opacity-40 flex items-center gap-1" title="배정 삭제">
                <Trash2 size={10} /> 해제
              </button>
            )}
          </div>

          {cleaners.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {cleaners.map(c => {
                const isSelected = selectedCleaner === c.id;
                const isCurrent = selectedEvent.cleanerId === c.id;
                return (
                  <button key={c.id} onClick={() => setSelectedCleaner(isSelected ? '' : c.id)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-all ${
                      isSelected ? 'border-white/30 bg-white/10 text-white' : 'border-white/10 bg-black/30 text-white/50 hover:border-white/20 hover:text-white/70'
                    }`}>
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${
                      isSelected ? 'bg-white text-black' : 'bg-white/10 text-white/40'
                    }`}>{c.name.charAt(0)}</span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium truncate">
                        {c.name}
                        {isCurrent && <span className="ml-1 text-[9px] text-emerald-400">현재</span>}
                      </p>
                      {c.phone && <p className="text-[10px] text-white/30 truncate">{c.phone}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-[10px] text-white/30 text-center py-2">
              등록된 담당자가 없습니다.{' '}
              <a href="/admin/cleaners" className="text-white/60 underline hover:text-white transition-colors">담당자 관리</a>
              에서 먼저 추가하세요.
            </p>
          )}

          {selectedCleaner !== (selectedEvent.cleanerId ?? '') && (
            <button onClick={onSaveCleaner} disabled={cleanerSaving}
              className="w-full flex items-center justify-center gap-2 bg-white text-black py-2.5 rounded-lg text-[11px] tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              <Save size={13} /> {cleanerSaving ? '저장 중...' : '저장'}
            </button>
          )}

          {/* 정비 완료 버튼 */}
          {selectedEvent.cleaningId && selectedEvent.status !== 'done' && (
            isCheckinDay ? (
              <button onClick={onCompleteCleaning} disabled={completingCleaning}
                className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-2.5 rounded-lg text-[11px] tracking-widest font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <CheckCircle size={13} />
                {completingCleaning ? '처리 중...' : '정비 완료'}
                {selectedEvent.channelId === 'beds24' && !completingCleaning && (
                  <span className="text-[9px] font-normal text-emerald-200/70 ml-1">· 게스트 알림</span>
                )}
              </button>
            ) : (
              <div className="flex items-center gap-2 py-2 px-3 bg-white/[0.03] border border-white/10 rounded-lg">
                <CheckCircle size={13} className="text-white/20 shrink-0" />
                <span className="text-[11px] text-white/30">체크인 당일에 정비 완료 처리할 수 있습니다</span>
              </div>
            )
          )}

          {selectedEvent.status === 'done' && (
            <div className="flex items-center gap-2 py-2 px-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <CheckCircle size={13} className="text-emerald-400 shrink-0" />
              <span className="text-[11px] text-emerald-300/80">정비 완료</span>
            </div>
          )}
        </div>

        {/* Supply TODO list */}
        <div className="border-t border-white/[0.08] pt-5 space-y-3">
          <p className="text-[10px] tracking-widest text-white/40 font-medium">필요 비품</p>
          {supplyTodos.length > 0 && (
            <div className="space-y-1.5">
              {supplyTodos.map(todo => (
                <div key={todo.id} className="flex items-center gap-2.5 group">
                  <button onClick={() => onToggleSupply(todo.id, !todo.done)}
                    className={`w-4.5 h-4.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      todo.done ? 'bg-emerald-500/30 border-emerald-500/50' : 'border-white/20 hover:border-white/40'
                    }`}>
                    {todo.done && <span className="text-emerald-400 text-[10px]">✓</span>}
                  </button>
                  <span className={`text-[12px] flex-1 ${todo.done ? 'text-white/30 line-through' : 'text-white/70'}`}>{todo.text}</span>
                  <button onClick={() => onDeleteSupply(todo.id)}
                    className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all shrink-0">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input value={newSupply} onChange={e => setNewSupply(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onAddSupply()}
              placeholder="비품 항목 추가 (예: 수건 4장)"
              className="flex-1 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white focus:outline-none focus:border-white/30 transition-colors placeholder:text-white/20" />
            <button onClick={onAddSupply} disabled={!newSupply.trim()}
              className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white/60 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              추가
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] tracking-[0.2em] text-white/40 uppercase">메시지</p>
            {selectedEvent.channelId === 'beds24' && isLoggedIn && (
              <button onClick={onSyncMessages} disabled={syncingMessages}
                className="flex items-center gap-1.5 text-[9px] tracking-wide text-white/40 hover:text-white/60 transition-colors disabled:opacity-30">
                <RefreshCw size={10} className={syncingMessages ? 'animate-spin' : ''} />
                {syncingMessages ? '동기화 중' : '동기화'}
              </button>
            )}
          </div>

          {loadingMessages ? (
            <p className="text-[10px] text-white/30 text-center py-4">불러오는 중...</p>
          ) : modalMessages.length > 0 ? (
            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {modalMessages.map((msg, idx) => {
                const msgDate = new Date(msg.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
                const prevDate = idx > 0 ? new Date(modalMessages[idx - 1].createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : null;
                const showDate = idx === 0 || msgDate !== prevDate;
                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div className="flex items-center gap-2 py-2">
                        <div className="flex-1 h-px bg-white/8" />
                        <span className="text-[9px] text-white/25 tracking-wide">{msgDate}</span>
                        <div className="flex-1 h-px bg-white/8" />
                      </div>
                    )}
                    <div className={`flex ${msg.sender === 'host' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-[11px] leading-relaxed ${
                        msg.sender === 'host'
                          ? 'bg-white text-black rounded-tr-sm'
                          : msg.source === 'beds24'
                            ? 'bg-indigo-500/15 border border-indigo-500/20 text-white/80 rounded-tl-sm'
                            : 'bg-white/[0.07] text-white/80 rounded-tl-sm'
                      }`}>
                        {msg.source === 'beds24' && (
                          <p className={`text-[8px] font-medium mb-0.5 ${msg.sender === 'host' ? 'text-black/30' : 'text-indigo-400/70'}`}>
                            Beds24 · {msg.beds24MessageType || msg.sender}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                        <p className={`text-[8px] mt-1 ${msg.sender === 'host' ? 'text-black/40' : 'text-white/25'}`}>
                          {new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[10px] text-white/30 text-center py-2">아직 메시지가 없습니다</p>
          )}

          <div className="flex gap-2">
            <input type="text" value={newMessage} onChange={e => setNewMessage(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendMessage(); } }}
              placeholder="메시지 입력..."
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors" />
            <button onClick={onSendMessage} disabled={!newMessage.trim() || sendingMessage}
              className="px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              <Send size={13} className="text-white/70" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
