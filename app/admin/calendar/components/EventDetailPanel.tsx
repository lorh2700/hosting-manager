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

const labelCls = 'text-xs text-stone-500 font-medium';
const inputCls = 'w-full bg-white border border-stone-200 px-3 py-2 text-[13px] text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors placeholder:text-stone-400';

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
    <div className="fixed inset-0 z-50 flex justify-end bg-stone-950/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white border-l border-stone-200 w-full max-w-md p-6 space-y-5 h-full overflow-y-auto animate-slide-in-right shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Unassigned navigation */}
        {unassignedCleanings.length > 0 && !selectedEvent.cleanerId && (
          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 px-3 py-2">
            <span className="text-xs text-amber-800">
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
                className="px-2 py-1 text-amber-700 bg-amber-100 hover:bg-amber-200 transition-colors"
              >
                <ChevronLeft size={12} />
              </button>
              <button
                onClick={() => {
                  const idx = sortedUnassigned.findIndex(e => e.id === selectedEvent.eventId);
                  const next = sortedUnassigned[(idx + 1) % sortedUnassigned.length];
                  if (next) openModal(next);
                }}
                className="px-2 py-1 text-amber-700 bg-amber-100 hover:bg-amber-200 transition-colors"
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
              <p className="text-xs text-stone-500 font-medium">{selectedEvent.propertyName}</p>
              <div className="flex items-center gap-2 mt-1">
                {isBlock && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-rose-50 text-rose-600">
                    <Ban size={10} /> 차단
                  </span>
                )}
                <h3 className="text-stone-900 font-semibold text-lg leading-snug truncate">{selectedEvent.title}</h3>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-900 transition-colors shrink-0 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Info */}
        <div className="space-y-2 bg-stone-50 px-4 py-3.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-stone-500">채널</span>
            <span className="text-stone-800 text-xs">{selectedEvent.channelLabel}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-stone-500">체크인</span>
            <span className="text-stone-700 text-xs tabular-nums">{selectedEvent.start}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-stone-500">체크아웃</span>
            <span className="text-stone-700 text-xs tabular-nums">{selectedEvent.end}</span>
          </div>
          {nights > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-stone-500">숙박</span>
              <span className="text-stone-700 text-xs">{nights}박 {nights + 1}일</span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-xs text-stone-500">추천 비밀번호</span>
            <span className={`text-xs tabular-nums ${suggestedPassword === '없음' ? 'text-stone-400' : 'text-stone-900 font-semibold'}`}>
              {suggestedPassword}
            </span>
          </div>
          {filteredDescription && (
            <div className="pt-2.5 mt-1 border-t border-stone-200">
              <p className="text-xs text-stone-500 mb-1.5">{isBlock ? '차단 메모' : '예약 메모'}</p>
              <p className="text-stone-700 text-xs whitespace-pre-line leading-relaxed">{filteredDescription}</p>
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="border-t border-stone-200 pt-5 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className={`${labelCls} flex items-center gap-1.5`}>
              <TagIcon size={11} /> 태그
            </p>
            {savingTags && <RefreshCw size={11} className="animate-spin text-[var(--brand)]" />}
          </div>

          {(selectedEvent.tags?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedEvent.tags.map(t => (
                <span key={t} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 text-xs bg-[var(--brand-tint)] text-[var(--brand-dark)]">
                  {t}
                  <button
                    onClick={() => removeTag(t)}
                    disabled={savingTags}
                    className="p-0.5 text-[var(--brand)] hover:text-[var(--brand-dark)] transition-colors disabled:opacity-40"
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
              className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 shrink-0"
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
                className="text-[11px] px-2.5 py-0.5 bg-stone-100 text-stone-500 hover:text-stone-900 hover:bg-stone-200 transition-colors disabled:opacity-40"
              >
                + {p}
              </button>
            ))}
          </div>
        </div>

        {/* Cancel */}
        {canCancel && (
          <div className="border-t border-stone-200 pt-5">
            <button
              onClick={onCancelEvent}
              disabled={cancellingEvent}
              className="w-full flex items-center justify-center gap-2 bg-rose-50 hover:bg-rose-100 text-rose-600 py-2.5 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} /> {cancellingEvent ? '취소 중...' : `${isBlock ? '차단' : '예약'} 취소 (Beds24 동기화)`}
            </button>
            <p className="mt-2 text-xs text-stone-500 text-center">
              Beds24에서 이 {isBlock ? '차단' : '예약'}을 취소하고 로컬에서도 삭제합니다.
            </p>
          </div>
        )}

        {/* Cleaner */}
        {!isBlock && (
          <>
            <div className="border-t border-stone-200 pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className={labelCls}>청소 담당자</p>
                {selectedEvent.cleaningId && (
                  <button
                    onClick={onDeleteCleaner}
                    disabled={cleanerSaving}
                    className="text-xs text-stone-500 hover:text-rose-600 transition-colors disabled:opacity-40 flex items-center gap-1"
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
                        className={`flex items-center gap-2.5 px-3 py-2.5 text-left transition-all ${
                          isUnassignedSelected
                            ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-300'
                            : 'bg-stone-50 text-stone-500 hover:bg-stone-100 hover:text-stone-800'
                        }`}
                      >
                        <span className={`w-7 h-7 flex items-center justify-center text-xs font-semibold shrink-0 ${
                          isUnassignedSelected ? 'bg-amber-300 text-amber-900' : 'bg-stone-200 text-stone-500'
                        }`}>—</span>
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium truncate">
                            미배정
                            {isCurrentlyUnassigned && <span className="ml-1 text-[10px] text-[var(--brand)]">현재</span>}
                          </p>
                          <p className="text-[10px] text-stone-400 truncate">담당자 없음</p>
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
                        className={`flex items-center gap-2.5 px-3 py-2.5 text-left transition-all ${
                          isSelected
                            ? 'bg-[var(--brand-tint)] text-stone-900 ring-1 ring-[var(--brand)]/40'
                            : 'bg-stone-50 text-stone-500 hover:bg-stone-100 hover:text-stone-800'
                        }`}
                      >
                        <span className={`w-7 h-7 flex items-center justify-center text-xs font-semibold shrink-0 ${
                          isSelected ? 'bg-[var(--brand)] text-white' : 'bg-stone-200 text-stone-500'
                        }`}>{c.name.charAt(0)}</span>
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium truncate">
                            {c.name}
                            {isCurrent && <span className="ml-1 text-[10px] text-[var(--brand)]">현재</span>}
                          </p>
                          {c.phone && <p className="text-[10px] text-stone-400 truncate">{c.phone}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-stone-500 text-center py-2">
                  등록된 담당자가 없습니다.{' '}
                  <a href="/admin/cleaners" className="text-[var(--brand)] underline hover:text-[var(--brand-dark)] transition-colors">담당자 관리</a>
                  에서 먼저 추가하세요.
                </p>
              )}

              {selectedCleaner !== (selectedEvent.cleanerId ?? '') && (
                <button
                  onClick={onSaveCleaner}
                  disabled={cleanerSaving}
                  className="w-full flex items-center justify-center gap-2 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white py-2.5 text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Save size={14} /> {cleanerSaving ? '저장 중...' : '저장'}
                </button>
              )}

              {selectedEvent.cleaningId && selectedEvent.status !== 'done' && (
                isCheckinDay ? (
                  <button
                    onClick={onCompleteCleaning}
                    disabled={completingCleaning}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-2.5 text-sm font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <CheckCircle size={14} />
                    {completingCleaning ? '처리 중...' : '정비 완료'}
                    {selectedEvent.channelId === 'beds24' && !completingCleaning && (
                      <span className="text-[10px] font-normal text-white/70 ml-1">· 게스트 알림</span>
                    )}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 py-2 px-3 bg-stone-50">
                    <CheckCircle size={13} className="text-stone-400 shrink-0" />
                    <span className="text-xs text-stone-500">체크인 당일에 정비 완료 처리할 수 있습니다</span>
                  </div>
                )
              )}

              {selectedEvent.status === 'done' && (
                <div className="flex items-center gap-2 py-2 px-3 bg-emerald-50">
                  <CheckCircle size={13} className="text-emerald-600 shrink-0" />
                  <span className="text-xs text-emerald-700">정비 완료</span>
                </div>
              )}
            </div>

            {/* Supply TODO */}
            <div className="border-t border-stone-200 pt-5 space-y-3">
              <p className={labelCls}>필요 비품</p>
              {supplyTodos.length > 0 && (
                <div className="space-y-1.5">
                  {supplyTodos.map(todo => (
                    <div key={todo.id} className="flex items-center gap-2.5 group">
                      <button
                        onClick={() => onToggleSupply(todo.id, !todo.done)}
                        className={`w-4 h-4 border flex items-center justify-center shrink-0 transition-colors ${
                          todo.done ? 'bg-[var(--brand-tint)] border-[var(--brand)]/40' : 'border-stone-300 hover:border-[var(--brand)]'
                        }`}
                      >
                        {todo.done && <span className="text-[var(--brand-dark)] text-[10px]">✓</span>}
                      </button>
                      <span className={`text-[13px] flex-1 ${todo.done ? 'text-stone-400 line-through' : 'text-stone-800'}`}>{todo.text}</span>
                      <button
                        onClick={() => onDeleteSupply(todo.id)}
                        className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-rose-600 transition-all shrink-0"
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
                  className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                >
                  추가
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="border-t border-stone-200 pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className={labelCls}>메시지</p>
                {selectedEvent.channelId === 'beds24' && isLoggedIn && (
                  <button
                    onClick={onSyncMessages}
                    disabled={syncingMessages}
                    className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-700 transition-colors disabled:opacity-30"
                  >
                    <RefreshCw size={11} className={syncingMessages ? 'animate-spin' : ''} />
                    {syncingMessages ? '동기화 중' : '동기화'}
                  </button>
                )}
              </div>

              {loadingMessages ? (
                <p className="text-xs text-stone-500 text-center py-4">불러오는 중...</p>
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
                            <div className="flex-1 h-px bg-stone-200" />
                            <span className="text-[10px] text-stone-400">{msgDate}</span>
                            <div className="flex-1 h-px bg-stone-200" />
                          </div>
                        )}
                        <div className={`flex ${isHost ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[85%] px-3 py-2 text-xs leading-relaxed ${
                              isHost
                                ? 'bg-[var(--brand)] text-white'
                                : isBeds24
                                  ? 'bg-[var(--brand-tint)] text-stone-800'
                                  : 'bg-stone-100 text-stone-800'
                            }`}
                          >
                            {isBeds24 && (
                              <p className={`text-[10px] font-medium mb-0.5 ${
                                isHost ? 'text-white/70' : 'text-[var(--brand-dark)]'
                              }`}>
                                Beds24 · {msg.beds24MessageType || msg.sender}
                              </p>
                            )}
                            <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                            <p className={`text-[10px] mt-1 ${isHost ? 'text-white/70' : 'text-stone-400'}`}>
                              {new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-stone-500 text-center py-2">아직 메시지가 없습니다</p>
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
                  className="px-3 py-2 bg-[var(--brand)] hover:bg-[var(--brand-dark)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
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
