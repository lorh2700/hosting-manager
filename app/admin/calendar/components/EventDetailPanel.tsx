'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, X, Save, Trash2, Send, CheckCircle, RefreshCw, Tag as TagIcon, Plus, Ban } from 'lucide-react';
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
  savingTags: boolean;
  cancellingEvent: boolean;
  onClose: () => void;
  onSaveCleaner: () => void;
  onDeleteCleaner: () => void;
  onCompleteCleaning: () => void;
  onAddSupply: () => void;
  onToggleSupply: (id: string, done: boolean) => void;
  onDeleteSupply: (id: string) => void;
  onSendMessage: () => void;
  onSyncMessages: () => void;
  onUpdateTags: (tags: string[]) => Promise<void> | void;
  onCancelEvent: () => void;
  openModal: (e: ProcessedEvent) => void;
}

const TAG_PRESETS = ['픽업 요청', '늦은 체크인', '일찍 체크인', '반려동물', '유아 동반', '조용한 객실'];

const labelCls = 'text-xs text-white/55 font-medium';
const inputCls = 'w-full bg-black/30 border border-white/[0.08] rounded-xl px-3 py-2 text-[13px] text-white focus:outline-none focus:border-violet-400/60 transition-colors placeholder:text-white/25';

export function EventDetailPanel({
  selectedEvent, today, cleaners, selectedCleaner, setSelectedCleaner,
  cleanerSaving, completingCleaning,
  supplyTodos, newSupply, setNewSupply,
  modalMessages, newMessage, setNewMessage,
  sendingMessage, loadingMessages, syncingMessages,
  unassignedCleanings, sortedUnassigned, isLoggedIn,
  savingTags, cancellingEvent,
  onClose, onSaveCleaner, onDeleteCleaner, onCompleteCleaning,
  onAddSupply, onToggleSupply, onDeleteSupply,
  onSendMessage, onSyncMessages, onUpdateTags, onCancelEvent, openModal,
}: EventDetailPanelProps) {
  const [newTag, setNewTag] = useState('');
  const isBlock = selectedEvent.type === 'block';
  const isManualReservation = selectedEvent.source === 'manual-reservation' && selectedEvent.type === 'reservation';
  const canCancel = isBlock || isManualReservation;

  const addTag = async (raw: string) => {
    const t = raw.trim();
    if (!t || t.length > 40) return;
    const next = Array.from(new Set([...(selectedEvent.tags ?? []), t])).slice(0, 20);
    await onUpdateTags(next);
    setNewTag('');
  };
  const removeTag = async (t: string) => {
    const next = (selectedEvent.tags ?? []).filter(x => x !== t);
    await onUpdateTags(next);
  };
  const nights = Math.round(
    (new Date(selectedEvent.end).getTime() - new Date(selectedEvent.start).getTime()) / 86400000,
  );

  const filteredDescription = selectedEvent.description
    ?.split('\n')
    .filter(line => !line.trimStart().startsWith('금액'))
    .join('\n')
    .trim();

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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#141416] border-l border-white/[0.06] w-full max-w-md p-6 space-y-5 h-full overflow-y-auto animate-slide-in-right"
        onClick={e => e.stopPropagation()}
      >
        {/* Unassigned navigation */}
        {unassignedCleanings.length > 0 && !selectedEvent.cleanerId && (
          <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
            <span className="text-xs text-amber-200">
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
                className="px-2 py-1 text-amber-200/70 bg-amber-500/15 hover:bg-amber-500/25 rounded-md transition-colors"
              >
                <ChevronLeft size={12} />
              </button>
              <button
                onClick={() => {
                  const idx = sortedUnassigned.findIndex(e => e.id === selectedEvent.eventId);
                  const next = sortedUnassigned[(idx + 1) % sortedUnassigned.length];
                  if (next) openModal(next);
                }}
                className="px-2 py-1 text-amber-200/70 bg-amber-500/15 hover:bg-amber-500/25 rounded-md transition-colors"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <span className="w-3 h-3 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: selectedEvent.propertyColor }} />
            <div className="min-w-0">
              <p className="text-xs text-white/55 font-medium">{selectedEvent.propertyName}</p>
              <div className="flex items-center gap-2 mt-1">
                {isBlock && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-rose-500/15 text-rose-300 rounded">
                    <Ban size={10} /> 차단
                  </span>
                )}
                <h3 className="text-white font-semibold text-lg leading-snug truncate">{selectedEvent.title}</h3>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-white/45 hover:text-white transition-colors shrink-0 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Info */}
        <div className="space-y-2 bg-white/[0.03] rounded-2xl px-4 py-3.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/45">채널</span>
            <span className="text-white/80 text-xs">{selectedEvent.channelLabel}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/45">체크인</span>
            <span className="text-white/75 text-xs tabular-nums">{selectedEvent.start}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/45">체크아웃</span>
            <span className="text-white/75 text-xs tabular-nums">{selectedEvent.end}</span>
          </div>
          {nights > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-white/45">숙박</span>
              <span className="text-white/75 text-xs">{nights}박 {nights + 1}일</span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/45">추천 비밀번호</span>
            <span className={`text-xs tabular-nums ${suggestedPassword === '없음' ? 'text-white/30' : 'text-white/85 font-semibold'}`}>
              {suggestedPassword}
            </span>
          </div>
          {filteredDescription && (
            <div className="pt-2.5 mt-1 border-t border-white/[0.06]">
              <p className="text-xs text-white/45 mb-1.5">{isBlock ? '차단 메모' : '예약 메모'}</p>
              <p className="text-white/65 text-xs whitespace-pre-line leading-relaxed">{filteredDescription}</p>
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="border-t border-white/[0.06] pt-5 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className={`${labelCls} flex items-center gap-1.5`}>
              <TagIcon size={11} /> 태그
            </p>
            {savingTags && <RefreshCw size={11} className="animate-spin text-violet-400" />}
          </div>

          {(selectedEvent.tags?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedEvent.tags.map(t => (
                <span key={t} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 text-xs bg-violet-500/15 text-violet-100 rounded-full">
                  {t}
                  <button
                    onClick={() => removeTag(t)}
                    disabled={savingTags}
                    className="p-0.5 text-violet-200/65 hover:text-white transition-colors disabled:opacity-40"
                    aria-label={`${t} 삭제`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag(newTag);
                }
              }}
              placeholder="예: 픽업 요청"
              maxLength={40}
              className={inputCls}
            />
            <button
              onClick={() => addTag(newTag)}
              disabled={!newTag.trim() || savingTags}
              className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-white/75 rounded-xl text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 shrink-0"
            >
              <Plus size={12} /> 추가
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {TAG_PRESETS.filter(p => !(selectedEvent.tags ?? []).includes(p)).map(p => (
              <button
                key={p}
                onClick={() => addTag(p)}
                disabled={savingTags}
                className="text-[11px] px-2.5 py-0.5 bg-white/[0.04] text-white/55 hover:text-white hover:bg-white/[0.08] rounded-full transition-colors disabled:opacity-40"
              >
                + {p}
              </button>
            ))}
          </div>
        </div>

        {/* Cancel */}
        {canCancel && (
          <div className="border-t border-white/[0.06] pt-5">
            <button
              onClick={onCancelEvent}
              disabled={cancellingEvent}
              className="w-full flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} /> {cancellingEvent ? '취소 중...' : `${isBlock ? '차단' : '예약'} 취소 (Beds24 동기화)`}
            </button>
            <p className="mt-2 text-xs text-white/40 text-center">
              Beds24에서 이 {isBlock ? '차단' : '예약'}을 취소하고 로컬에서도 삭제합니다.
            </p>
          </div>
        )}

        {/* Cleaner */}
        {!isBlock && (
          <>
            <div className="border-t border-white/[0.06] pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className={labelCls}>청소 담당자</p>
                {selectedEvent.cleaningId && (
                  <button
                    onClick={onDeleteCleaner}
                    disabled={cleanerSaving}
                    className="text-xs text-white/45 hover:text-rose-400 transition-colors disabled:opacity-40 flex items-center gap-1"
                    title="배정 삭제"
                  >
                    <Trash2 size={11} /> 해제
                  </button>
                )}
              </div>

              {cleaners.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {(() => {
                    const isUnassignedSelected = selectedCleaner === '';
                    const isCurrentlyUnassigned = !selectedEvent.cleanerId;
                    return (
                      <button
                        onClick={() => setSelectedCleaner('')}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all ${
                          isUnassignedSelected
                            ? 'bg-amber-500/15 text-amber-100 ring-1 ring-amber-400/30'
                            : 'bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white/80'
                        }`}
                      >
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                          isUnassignedSelected ? 'bg-amber-300 text-black' : 'bg-white/10 text-white/45'
                        }`}>—</span>
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium truncate">
                            미배정
                            {isCurrentlyUnassigned && <span className="ml-1 text-[10px] text-violet-300">현재</span>}
                          </p>
                          <p className="text-[10px] text-white/35 truncate">담당자 없음</p>
                        </div>
                      </button>
                    );
                  })()}
                  {cleaners.map(c => {
                    const isSelected = selectedCleaner === c.id;
                    const isCurrent = selectedEvent.cleanerId === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedCleaner(c.id)}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all ${
                          isSelected
                            ? 'bg-violet-500/20 text-white ring-1 ring-violet-400/40'
                            : 'bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white/80'
                        }`}
                      >
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                          isSelected ? 'bg-violet-500 text-white' : 'bg-white/10 text-white/45'
                        }`}>{c.name.charAt(0)}</span>
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium truncate">
                            {c.name}
                            {isCurrent && <span className="ml-1 text-[10px] text-violet-300">현재</span>}
                          </p>
                          {c.phone && <p className="text-[10px] text-white/35 truncate">{c.phone}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-white/40 text-center py-2">
                  등록된 담당자가 없습니다.{' '}
                  <a href="/admin/cleaners" className="text-violet-300 underline hover:text-violet-200 transition-colors">담당자 관리</a>
                  에서 먼저 추가하세요.
                </p>
              )}

              {selectedCleaner !== (selectedEvent.cleanerId ?? '') && (
                <button
                  onClick={onSaveCleaner}
                  disabled={cleanerSaving}
                  className="w-full flex items-center justify-center gap-2 bg-violet-500 hover:bg-violet-400 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Save size={14} /> {cleanerSaving ? '저장 중...' : '저장'}
                </button>
              )}

              {selectedEvent.cleaningId && selectedEvent.status !== 'done' && (
                isCheckinDay ? (
                  <button
                    onClick={onCompleteCleaning}
                    disabled={completingCleaning}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <CheckCircle size={14} />
                    {completingCleaning ? '처리 중...' : '정비 완료'}
                    {selectedEvent.channelId === 'beds24' && !completingCleaning && (
                      <span className="text-[10px] font-normal text-emerald-100/80 ml-1">· 게스트 알림</span>
                    )}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 py-2 px-3 bg-white/[0.04] rounded-xl">
                    <CheckCircle size={13} className="text-white/30 shrink-0" />
                    <span className="text-xs text-white/45">체크인 당일에 정비 완료 처리할 수 있습니다</span>
                  </div>
                )
              )}

              {selectedEvent.status === 'done' && (
                <div className="flex items-center gap-2 py-2 px-3 bg-emerald-500/10 rounded-xl">
                  <CheckCircle size={13} className="text-emerald-400 shrink-0" />
                  <span className="text-xs text-emerald-300">정비 완료</span>
                </div>
              )}
            </div>

            {/* Supply TODO */}
            <div className="border-t border-white/[0.06] pt-5 space-y-3">
              <p className={labelCls}>필요 비품</p>
              {supplyTodos.length > 0 && (
                <div className="space-y-1.5">
                  {supplyTodos.map(todo => (
                    <div key={todo.id} className="flex items-center gap-2.5 group">
                      <button
                        onClick={() => onToggleSupply(todo.id, !todo.done)}
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          todo.done ? 'bg-violet-500/30 border-violet-500/50' : 'border-white/25 hover:border-violet-400'
                        }`}
                      >
                        {todo.done && <span className="text-violet-200 text-[10px]">✓</span>}
                      </button>
                      <span className={`text-[13px] flex-1 ${todo.done ? 'text-white/30 line-through' : 'text-white/80'}`}>{todo.text}</span>
                      <button
                        onClick={() => onDeleteSupply(todo.id)}
                        className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-rose-400 transition-all shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={newSupply}
                  onChange={e => setNewSupply(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && onAddSupply()}
                  placeholder="비품 항목 추가 (예: 수건 4장)"
                  className={inputCls}
                />
                <button
                  onClick={onAddSupply}
                  disabled={!newSupply.trim()}
                  className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-white/75 rounded-xl text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                >
                  추가
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="border-t border-white/[0.06] pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className={labelCls}>메시지</p>
                {selectedEvent.channelId === 'beds24' && isLoggedIn && (
                  <button
                    onClick={onSyncMessages}
                    disabled={syncingMessages}
                    className="flex items-center gap-1.5 text-xs text-white/45 hover:text-white/75 transition-colors disabled:opacity-30"
                  >
                    <RefreshCw size={11} className={syncingMessages ? 'animate-spin' : ''} />
                    {syncingMessages ? '동기화 중' : '동기화'}
                  </button>
                )}
              </div>

              {loadingMessages ? (
                <p className="text-xs text-white/40 text-center py-4">불러오는 중...</p>
              ) : modalMessages.length > 0 ? (
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                  {modalMessages.map((msg, idx) => {
                    const msgDate = new Date(msg.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
                    const prevDate = idx > 0 ? new Date(modalMessages[idx - 1].createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : null;
                    const showDate = idx === 0 || msgDate !== prevDate;
                    const isHost = msg.sender === 'host';
                    const isBeds24 = msg.source === 'beds24';
                    return (
                      <div key={msg.id}>
                        {showDate && (
                          <div className="flex items-center gap-2 py-2">
                            <div className="flex-1 h-px bg-white/[0.08]" />
                            <span className="text-[10px] text-white/35">{msgDate}</span>
                            <div className="flex-1 h-px bg-white/[0.08]" />
                          </div>
                        )}
                        <div className={`flex ${isHost ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                              isHost
                                ? 'bg-violet-500 text-white rounded-tr-sm'
                                : isBeds24
                                  ? 'bg-violet-500/12 text-white/85 rounded-tl-sm'
                                  : 'bg-white/[0.06] text-white/85 rounded-tl-sm'
                            }`}
                          >
                            {isBeds24 && (
                              <p className={`text-[10px] font-medium mb-0.5 ${
                                isHost ? 'text-violet-100/65' : 'text-violet-300/80'
                              }`}>
                                Beds24 · {msg.beds24MessageType || msg.sender}
                              </p>
                            )}
                            <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                            <p className={`text-[10px] mt-1 ${isHost ? 'text-violet-100/65' : 'text-white/35'}`}>
                              {new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-white/40 text-center py-2">아직 메시지가 없습니다</p>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendMessage(); } }}
                  placeholder="메시지 입력..."
                  className={inputCls}
                />
                <button
                  onClick={onSendMessage}
                  disabled={!newMessage.trim() || sendingMessage}
                  className="px-3 py-2 bg-violet-500 hover:bg-violet-400 rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                >
                  <Send size={14} className="text-white" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
