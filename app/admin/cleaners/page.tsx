'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, Trash2, Save, Phone, Link as LinkIcon, Copy, RefreshCw, Check,
  KeyRound, ShieldCheck, Building2, Bell, BellOff, Mail, PauseCircle, PlayCircle,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { toast, confirmDialog } from '@/components/ui';

/**
 * 청소 담당자 관리 — 담당자의 정체성은 프로필이고, 로그인은 선택이다.
 *  1. 프로필: 이름·연락처
 *  2. 접속 방법: 앱 로그인(전화번호 + 뒷 4자리, 켜기/끄기) · 이메일 초대 · 공개 캘린더 링크
 *  3. 배정 지점: 비어 있으면 호스트의 모든 지점. 화면 표시·청소 신청·알림 대상이 모두 이 규칙
 *  4. 알림: 신규 청소 오픈 알림톡 수신 여부
 */

interface Cleaner {
  id: string;
  name: string;
  phone: string | null;
  publicToken: string | null;
  ownerId: string;
  userId: string | null;
  notifyNewOpen: boolean;
  login: { email: string; status: string } | null;
  assignedPropertyIds: string[];
  pendingInvitation: { id: string; email: string; token: string; expiresAt: string } | null;
}

interface Property {
  id: string;
  name: string;
}

function last4(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

const inputCls = 'w-full bg-white border border-stone-200 px-4 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors';
const smallBtn = 'text-xs text-stone-700 hover:text-stone-900 flex items-center gap-2 border border-stone-200 hover:border-stone-300 px-3 py-1.5 transition-colors disabled:opacity-50';
const labelCls = 'block text-[10px] uppercase tracking-widest text-stone-500 mb-2';

export default function CleanersPage() {
  const { user } = useAuth();
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchCleaners = useCallback(async () => {
    try {
      const [cleanersRes, propsRes] = await Promise.all([fetch('/api/cleaners'), fetch('/api/properties')]);
      if (!cleanersRes.ok) throw new Error('Failed to fetch cleaners');
      const data: Cleaner[] = await cleanersRes.json();
      setCleaners(data);
      if (propsRes.ok) setProperties(await propsRes.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) fetchCleaners();
  }, [user, fetchCleaners]);

  const patchLocal = (id: string, patch: Partial<Cleaner>) => {
    setCleaners(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  };

  /** PUT /api/cleaners — 응답으로 카드 전체를 갱신한다. */
  const putCleaner = async (id: string, body: Record<string, unknown>, failMsg: string): Promise<Cleaner | null> => {
    setBusy(id);
    try {
      const res = await fetch('/api/cleaners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.info(data.error || failMsg);
        return null;
      }
      setCleaners(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
      return data as Cleaner;
    } catch (err) {
      console.error(err);
      toast.info(failMsg);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim() || !user) return;
    setAdding(true);
    try {
      const res = await fetch('/api/cleaners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), phone: newPhone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || '담당자 추가에 실패했습니다.');
        return;
      }
      setNewName('');
      setNewPhone('');
      await fetchCleaners();
    } catch (err) {
      console.error(err);
      toast.error('담당자 추가에 실패했습니다.');
    } finally {
      setAdding(false);
    }
  };

  const handleSaveProfile = (cleaner: Cleaner) =>
    putCleaner(cleaner.id, { name: cleaner.name, phone: cleaner.phone ?? '' }, '수정에 실패했습니다.');

  const handleDelete = async (cleaner: Cleaner) => {
    const extra = cleaner.login ? '\n연결된 앱 로그인 계정도 함께 삭제됩니다.' : '';
    if (!(await confirmDialog(`${cleaner.name} 담당자를 삭제하시겠습니까?${extra}`))) return;
    setBusy(cleaner.id);
    try {
      const res = await fetch(`/api/cleaners?id=${cleaner.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete cleaner');
      setCleaners(prev => prev.filter(c => c.id !== cleaner.id));
    } catch (err) {
      console.error(err);
      toast.error('삭제에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  };

  const toggleAssignment = async (cleaner: Cleaner, propertyId: string) => {
    const current = cleaner.assignedPropertyIds ?? [];
    const next = current.includes(propertyId) ? current.filter(id => id !== propertyId) : [...current, propertyId];
    setBusy(cleaner.id);
    patchLocal(cleaner.id, { assignedPropertyIds: next });
    try {
      const res = await fetch(`/api/cleaners/${cleaner.id}/properties`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyIds: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to update assignments');
      }
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : '지점 배정에 실패했습니다.');
      patchLocal(cleaner.id, { assignedPropertyIds: current });
    } finally {
      setBusy(null);
    }
  };

  const handleCreateOrResetLogin = async (cleaner: Cleaner) => {
    const msg = cleaner.login
      ? '비밀번호를 전화번호 뒷 4자리로 초기화하시겠습니까?'
      : '전화번호로 로그인하는 앱 계정을 만드시겠습니까? (비밀번호: 전화번호 뒷 4자리)';
    if (!(await confirmDialog(msg))) return;
    setBusy(cleaner.id);
    try {
      const res = await fetch(`/api/cleaners/${cleaner.id}/reset-password`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || '처리에 실패했습니다.');
        return;
      }
      await fetchCleaners();
    } catch (err) {
      console.error(err);
      toast.error('처리에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  };

  const handleInviteByEmail = async (cleaner: Cleaner) => {
    const email = prompt('담당자가 가입에 쓸 이메일을 입력하세요. 가입하면 이 프로필에 연결됩니다.');
    if (!email?.trim()) return;
    setBusy(cleaner.id);
    try {
      const res = await fetch(`/api/cleaners/${cleaner.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || '초대에 실패했습니다.');
        return;
      }
      patchLocal(cleaner.id, { pendingInvitation: { id: data.id, email: data.email, token: data.token, expiresAt: data.expiresAt } });
    } catch (err) {
      console.error(err);
      toast.error('초대에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(prev => (prev === key ? null : prev)), 2000);
    } catch {
      toast.error('복사에 실패했습니다.');
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = (token: string | null) => (token ? `${origin}/c/${token}` : '');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-[var(--brand)] rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 sm:space-y-10">
      <header className="border-b border-stone-200 pb-6 sm:pb-7">
        <p className="text-[11px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">숙박 호스팅</p>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">청소 담당자 관리</h1>
        <p className="text-stone-500 mt-2 text-sm">
          프로필을 만들고, 필요하면 앱 로그인이나 공개 링크로 일정을 공유하세요. 배정 지점은 화면·청소 신청·알림에 모두 적용됩니다.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* 새 담당자 추가 */}
        <div className="bg-white border border-stone-200 p-5 sm:p-8 lg:sticky lg:top-6">
          <h2 className="text-sm tracking-widest font-medium text-stone-900 mb-6">새 담당자 추가</h2>

          <div className="space-y-4 mb-8">
            <div>
              <label className={labelCls}>이름 *</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="담당자 이름"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>연락처</label>
              <input
                type="tel"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="010-0000-0000"
                className={inputCls}
              />
              <p className="text-[10px] text-stone-400 mt-1.5">알림톡 수신과 앱 로그인에 쓰입니다. 로그인 계정은 프로필을 만든 뒤 따로 켭니다.</p>
            </div>
          </div>

          <button
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
            className={`w-full py-4 text-[11px] tracking-widest font-semibold uppercase flex items-center justify-center gap-2 transition-colors ${
              newName.trim() ? 'bg-[var(--brand)] text-white hover:bg-[var(--brand-dark)]' : 'bg-stone-100 text-stone-400 cursor-not-allowed'
            }`}
          >
            <Plus size={14} />
            {adding ? '추가 중...' : '담당자 추가'}
          </button>
        </div>

        {/* 담당자 목록 */}
        <div className="space-y-4">
          <h2 className="text-sm tracking-widest font-medium text-stone-900 mb-4">
            등록된 담당자
            <span className="ml-3 text-stone-400 font-light">{cleaners.length}명</span>
          </h2>

          {cleaners.length === 0 ? (
            <div className="bg-white border border-stone-200 p-12 text-center flex flex-col items-center text-stone-400">
              <Users size={32} className="mb-4 opacity-50" />
              <p className="text-sm">등록된 담당자가 없습니다.</p>
              <p className="text-xs mt-2 text-stone-400">왼쪽 양식으로 담당자를 추가하세요.</p>
            </div>
          ) : (
            cleaners.map(cleaner => {
              const isBusy = busy === cleaner.id;
              const loginActive = cleaner.login?.status === 'active';
              return (
                <div key={cleaner.id} className="bg-white border border-stone-200 p-5 sm:p-6 hover:border-stone-300 transition-colors">
                  <div className="space-y-5">
                    {/* 1. 프로필 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>이름</label>
                        <input
                          type="text"
                          value={cleaner.name}
                          onChange={e => patchLocal(cleaner.id, { name: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>연락처</label>
                        <div className="flex items-center gap-2">
                          <Phone size={14} className="text-stone-400 shrink-0" />
                          <input
                            type="tel"
                            value={cleaner.phone ?? ''}
                            onChange={e => patchLocal(cleaner.id, { phone: e.target.value })}
                            placeholder="연락처 없음"
                            className={inputCls}
                          />
                        </div>
                      </div>
                    </div>

                    {/* 2. 접속 방법 */}
                    <div className="border-t border-stone-100 pt-4">
                      <label className={labelCls}>앱 로그인</label>
                      {!cleaner.login ? (
                        <div className="space-y-2">
                          <p className="text-xs text-stone-500">
                            {cleaner.phone ? '아직 앱 로그인 계정이 없습니다. 공개 링크만으로도 일정 확인은 가능합니다.' : '전화번호를 등록하면 앱 로그인을 만들 수 있습니다.'}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => handleCreateOrResetLogin(cleaner)} disabled={isBusy || !cleaner.phone} className={smallBtn}>
                              <KeyRound size={12} /> 전화번호 로그인 만들기
                            </button>
                            {cleaner.pendingInvitation ? (
                              <button
                                onClick={() => copyText(`inv-${cleaner.id}`, `${origin}/invite/${cleaner.pendingInvitation!.token}`)}
                                className={smallBtn}
                                title={`${cleaner.pendingInvitation.email} 초대 대기중`}
                              >
                                {copied === `inv-${cleaner.id}` ? <Check size={12} className="text-emerald-600" /> : <Mail size={12} />}
                                초대 링크 복사 ({cleaner.pendingInvitation.email})
                              </button>
                            ) : (
                              <button onClick={() => handleInviteByEmail(cleaner)} disabled={isBusy} className={smallBtn}>
                                <Mail size={12} /> 이메일로 초대
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs">
                            {loginActive ? (
                              <>
                                <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
                                <span className="text-emerald-600">사용 중</span>
                              </>
                            ) : (
                              <>
                                <PauseCircle size={14} className="text-stone-400 shrink-0" />
                                <span className="text-stone-500">꺼짐</span>
                              </>
                            )}
                            <span className="text-stone-500">
                              {last4(cleaner.phone) ? `전화번호 로그인 · 초기 비번 ${last4(cleaner.phone)}` : cleaner.login.email}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => handleCreateOrResetLogin(cleaner)} disabled={isBusy || !cleaner.phone} className={smallBtn}>
                              <KeyRound size={12} /> 비밀번호 초기화
                            </button>
                            {loginActive ? (
                              <button
                                onClick={() => putCleaner(cleaner.id, { loginEnabled: false }, '로그인 끄기에 실패했습니다.')}
                                disabled={isBusy}
                                className={smallBtn}
                              >
                                <PauseCircle size={12} /> 로그인 끄기
                              </button>
                            ) : (
                              <button
                                onClick={() => putCleaner(cleaner.id, { loginEnabled: true }, '로그인 켜기에 실패했습니다.')}
                                disabled={isBusy}
                                className={smallBtn}
                              >
                                <PlayCircle size={12} /> 로그인 켜기
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className={labelCls}>공개 캘린더 링크</label>
                      {cleaner.publicToken ? (
                        <div className="flex items-center gap-2">
                          <LinkIcon size={14} className="text-stone-400 shrink-0" />
                          <input
                            type="text"
                            readOnly
                            value={publicUrl(cleaner.publicToken)}
                            onFocus={e => e.currentTarget.select()}
                            className="flex-1 bg-white border border-stone-200 px-4 py-2.5 text-xs text-stone-700 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors font-mono truncate"
                          />
                          <button
                            onClick={() => copyText(`link-${cleaner.id}`, publicUrl(cleaner.publicToken))}
                            className="p-2.5 border border-stone-200 text-stone-500 hover:text-stone-900 hover:border-stone-300 transition-colors"
                            title="링크 복사"
                          >
                            {copied === `link-${cleaner.id}` ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                          </button>
                          <button
                            onClick={async () => {
                              if (await confirmDialog({ title: '공개 링크 재발급', message: '기존 링크는 사용할 수 없게 됩니다.', confirmLabel: '재발급', danger: true })) {
                                putCleaner(cleaner.id, { regenerateToken: true }, '링크 재발급에 실패했습니다.');
                              }
                            }}
                            disabled={isBusy}
                            className="p-2.5 border border-stone-200 text-stone-500 hover:text-stone-900 hover:border-stone-300 transition-colors disabled:opacity-50"
                            title="링크 재발급"
                          >
                            <RefreshCw size={14} className={isBusy ? 'animate-spin' : ''} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => putCleaner(cleaner.id, { regenerateToken: true }, '링크 발급에 실패했습니다.')}
                          disabled={isBusy}
                          className={smallBtn}
                        >
                          <RefreshCw size={12} /> 링크 발급
                        </button>
                      )}
                    </div>

                    {/* 3. 배정 지점 */}
                    <div className="border-t border-stone-100 pt-4">
                      <label className={`${labelCls} flex items-center gap-2`}>
                        <Building2 size={12} /> 배정 지점
                        {isBusy && <span className="text-stone-400 normal-case tracking-normal">저장 중…</span>}
                      </label>
                      {properties.length === 0 ? (
                        <p className="text-xs text-stone-400">등록된 지점이 없습니다.</p>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-2">
                            {properties.map(p => {
                              const active = cleaner.assignedPropertyIds?.includes(p.id);
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => toggleAssignment(cleaner, p.id)}
                                  disabled={isBusy}
                                  className={`text-xs px-3 py-1.5 border tracking-wide transition-colors disabled:opacity-50 ${
                                    active
                                      ? 'bg-[var(--brand)] text-white border-[var(--brand)]'
                                      : 'bg-transparent text-stone-700 border-stone-300 hover:border-stone-400 hover:text-stone-900'
                                  }`}
                                >
                                  {p.name}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-[10px] text-stone-400 mt-2 tracking-wide">
                            {cleaner.assignedPropertyIds?.length
                              ? `${cleaner.assignedPropertyIds.length}개 지점의 일정만 보이고, 그 지점의 청소만 신청·알림 받습니다.`
                              : '지정 없음 — 모든 지점의 일정을 보고 신청·알림 받습니다.'}
                          </p>
                        </>
                      )}
                    </div>

                    {/* 4. 알림 */}
                    <div className="border-t border-stone-100 pt-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-stone-500">신규 청소 오픈 알림톡</p>
                        <p className="text-xs text-stone-500 mt-1">
                          {cleaner.notifyNewOpen ? '새 청소가 열리면 알림톡을 받습니다.' : '받지 않습니다. (호스트 본인 프로필 등)'}
                        </p>
                      </div>
                      <button
                        onClick={() => putCleaner(cleaner.id, { notifyNewOpen: !cleaner.notifyNewOpen }, '알림 설정 변경에 실패했습니다.')}
                        disabled={isBusy || !cleaner.phone}
                        className={`${smallBtn} ${cleaner.notifyNewOpen ? 'text-emerald-700 border-emerald-200' : ''}`}
                        title={!cleaner.phone ? '전화번호가 있어야 알림톡을 받을 수 있습니다.' : undefined}
                      >
                        {cleaner.notifyNewOpen ? <Bell size={12} /> : <BellOff size={12} />}
                        {cleaner.notifyNewOpen ? '받는 중' : '꺼짐'}
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 mt-5">
                    <button
                      onClick={() => handleDelete(cleaner)}
                      disabled={isBusy}
                      className="p-2 text-stone-400 hover:text-red-600 transition-colors disabled:opacity-50"
                      title="삭제"
                    >
                      <Trash2 size={16} strokeWidth={1.5} />
                    </button>
                    <button
                      onClick={() => handleSaveProfile(cleaner)}
                      disabled={isBusy}
                      className="flex items-center gap-2 bg-stone-100 hover:bg-[var(--brand)] hover:text-white text-stone-900 px-4 py-2 text-[10px] tracking-widest font-semibold uppercase transition-colors disabled:opacity-50"
                    >
                      <Save size={13} />
                      {isBusy ? '저장 중...' : '프로필 저장'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
