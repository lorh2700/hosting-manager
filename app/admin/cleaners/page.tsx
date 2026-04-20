'use client';

import { useState, useEffect } from 'react';
import { Users, Plus, Trash2, Save, Phone, Link as LinkIcon, Copy, RefreshCw, Check, KeyRound, ShieldCheck, Building2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

interface Cleaner {
  id: string;
  name: string;
  phone: string;
  publicToken: string | null;
  ownerId: string;
  userId: string | null;
  linkedUser: { email: string; status: string } | null;
  assignedPropertyIds: string[];
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

export default function CleanersPage() {
  const { user, profile } = useAuth();
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [savingScopeId, setSavingScopeId] = useState<string | null>(null);

  const fetchCleaners = async () => {
    if (!user) return;
    try {
      const params = new URLSearchParams();
      if (profile?.role !== 'super_admin') {
        params.set('ownerId', user.id);
      }
      const [cleanersRes, propsRes] = await Promise.all([
        fetch(`/api/cleaners?${params}`),
        fetch('/api/properties'),
      ]);
      if (!cleanersRes.ok) throw new Error('Failed to fetch cleaners');
      const data: Cleaner[] = await cleanersRes.json();
      setCleaners(data);
      if (propsRes.ok) {
        const propsData: Property[] = await propsRes.json();
        setProperties(propsData);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCleaners();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const togglePropertyScope = async (cleaner: Cleaner, propertyId: string) => {
    if (!cleaner.userId) {
      alert('로그인 계정이 없는 담당자는 지점을 지정할 수 없습니다. 먼저 로그인 계정을 만들어 주세요.');
      return;
    }
    const current = cleaner.assignedPropertyIds ?? [];
    const next = current.includes(propertyId)
      ? current.filter(id => id !== propertyId)
      : [...current, propertyId];

    setSavingScopeId(cleaner.id);
    // Optimistic update
    setCleaners(prev => prev.map(c => c.id === cleaner.id ? { ...c, assignedPropertyIds: next } : c));
    try {
      const res = await fetch(`/api/cleaners/${cleaner.id}/properties`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyIds: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to update scope');
      }
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : '지점 지정에 실패했습니다.');
      // Revert
      setCleaners(prev => prev.map(c => c.id === cleaner.id ? { ...c, assignedPropertyIds: current } : c));
    } finally {
      setSavingScopeId(null);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim() || !user) return;
    setAdding(true);
    try {
      const res = await fetch('/api/cleaners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          phone: newPhone.trim(),
        }),
      });
      if (!res.ok) throw new Error('Failed to add cleaner');
      setNewName('');
      setNewPhone('');
      await fetchCleaners();
    } catch (err) {
      console.error(err);
      alert('담당자 추가에 실패했습니다.');
    } finally {
      setAdding(false);
    }
  };

  const handleUpdate = async (cleaner: Cleaner) => {
    setSaving(cleaner.id);
    try {
      const res = await fetch('/api/cleaners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cleaner.id,
          name: cleaner.name,
          phone: cleaner.phone,
        }),
      });
      if (!res.ok) throw new Error('Failed to update cleaner');
    } catch (err) {
      console.error(err);
      alert('수정에 실패했습니다.');
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (cleanerId: string) => {
    if (!confirm('이 담당자를 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`/api/cleaners?id=${cleanerId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete cleaner');
      setCleaners(prev => prev.filter(c => c.id !== cleanerId));
    } catch (err) {
      console.error(err);
      alert('삭제에 실패했습니다.');
    }
  };

  const updateLocal = (id: string, field: keyof Cleaner, value: string) => {
    setCleaners(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const publicUrl = (token: string | null) =>
    token && typeof window !== 'undefined' ? `${window.location.origin}/c/${token}` : '';

  const handleCopyLink = async (cleaner: Cleaner) => {
    const url = publicUrl(cleaner.publicToken);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(cleaner.id);
      setTimeout(() => setCopiedId(prev => prev === cleaner.id ? null : prev), 2000);
    } catch {
      alert('링크 복사에 실패했습니다.');
    }
  };

  const handleResetPassword = async (cleaner: Cleaner) => {
    const exists = !!cleaner.linkedUser;
    const msg = exists
      ? '비밀번호를 전화번호 뒷 4자리로 초기화하시겠습니까?'
      : '전화번호 뒷 4자리를 비밀번호로 하는 로그인 계정을 만드시겠습니까?';
    if (!confirm(msg)) return;
    setResettingId(cleaner.id);
    try {
      const res = await fetch(`/api/cleaners/${cleaner.id}/reset-password`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '처리에 실패했습니다.');
        return;
      }
      await fetchCleaners();
    } catch (err) {
      console.error(err);
      alert('처리에 실패했습니다.');
    } finally {
      setResettingId(null);
    }
  };

  const handleRegenerateToken = async (cleaner: Cleaner) => {
    if (!confirm('공개 링크를 재발급하시겠습니까? 기존 링크는 사용할 수 없게 됩니다.')) return;
    setRegeneratingId(cleaner.id);
    try {
      const res = await fetch('/api/cleaners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cleaner.id, regenerateToken: true }),
      });
      if (!res.ok) throw new Error('Failed to regenerate token');
      const updated: Cleaner = await res.json();
      setCleaners(prev => prev.map(c => c.id === cleaner.id ? { ...c, publicToken: updated.publicToken } : c));
    } catch (err) {
      console.error(err);
      alert('링크 재발급에 실패했습니다.');
    } finally {
      setRegeneratingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 sm:space-y-12">
      <header className="border-b border-white/10 pb-6 sm:pb-8">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-3 sm:mb-4">설정</p>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-light tracking-tight text-white">청소 담당자 관리</h1>
        <p className="text-white/50 mt-2 sm:mt-4 text-sm font-light tracking-wide">
          청소 담당자를 등록하고 청소 일정에 배정하세요.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* 새 담당자 추가 폼 */}
        <div className="bg-[#111] border border-white/10 p-5 sm:p-8 rounded-2xl sm:rounded-none lg:sticky lg:top-6">
          <h2 className="text-sm tracking-widest font-medium text-white mb-6">새 담당자 추가</h2>

          <div className="space-y-4 mb-8">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">이름 *</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="담당자 이름"
                className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">연락처</label>
              <input
                type="tel"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="010-0000-0000"
                className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>
          </div>

          <button
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
            className={`w-full py-4 text-[11px] tracking-widest font-semibold flex items-center justify-center gap-2 transition-colors ${
              newName.trim() ? 'bg-white text-black hover:bg-white/90' : 'bg-white/5 text-white/30 cursor-not-allowed'
            }`}
          >
            <Plus size={14} />
            {adding ? '추가 중...' : '담당자 추가'}
          </button>
        </div>

        {/* 담당자 목록 */}
        <div className="space-y-4">
          <h2 className="text-sm tracking-widest font-medium text-white mb-4">
            등록된 담당자
            <span className="ml-3 text-white/30 font-light">{cleaners.length}명</span>
          </h2>

          {cleaners.length === 0 ? (
            <div className="bg-[#111] border border-white/10 p-12 text-center flex flex-col items-center text-white/40">
              <Users size={32} className="mb-4 opacity-50" />
              <p className="text-sm">등록된 담당자가 없습니다.</p>
              <p className="text-xs mt-2 text-white/30">왼쪽 양식으로 담당자를 추가하세요.</p>
            </div>
          ) : (
            cleaners.map(cleaner => (
              <div key={cleaner.id} className="bg-[#111] border border-white/10 p-5 sm:p-6 rounded-2xl sm:rounded-none group hover:border-white/30 transition-colors">
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">이름</label>
                    <input
                      type="text"
                      value={cleaner.name}
                      onChange={e => updateLocal(cleaner.id, 'name', e.target.value)}
                      className="w-full bg-black/50 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">연락처</label>
                    <div className="flex items-center gap-2">
                      <Phone size={14} className="text-white/30 shrink-0" />
                      <input
                        type="tel"
                        value={cleaner.phone}
                        onChange={e => updateLocal(cleaner.id, 'phone', e.target.value)}
                        placeholder="연락처 없음"
                        className="flex-1 bg-black/50 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">로그인 계정</label>
                    {!cleaner.phone ? (
                      <p className="text-xs text-white/40">전화번호를 등록하면 로그인 계정이 자동 생성됩니다.</p>
                    ) : cleaner.linkedUser ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs">
                          <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
                          <span className="text-emerald-400">활성</span>
                          <span className="text-white/50">
                            전화번호 로그인 · 비번 {last4(cleaner.phone)}
                          </span>
                        </div>
                        <button
                          onClick={() => handleResetPassword(cleaner)}
                          disabled={resettingId === cleaner.id}
                          className="text-xs text-white/60 hover:text-white flex items-center gap-2 border border-white/10 hover:border-white/30 px-3 py-1.5 transition-colors disabled:opacity-50"
                        >
                          <KeyRound size={12} />
                          {resettingId === cleaner.id ? '처리 중...' : '비밀번호 초기화'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleResetPassword(cleaner)}
                        disabled={resettingId === cleaner.id}
                        className="text-xs text-white/60 hover:text-white flex items-center gap-2 border border-white/10 hover:border-white/30 px-3 py-2 transition-colors disabled:opacity-50"
                      >
                        <KeyRound size={12} />
                        {resettingId === cleaner.id ? '생성 중...' : '로그인 계정 생성'}
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2 flex items-center gap-2">
                      <Building2 size={12} /> 관리 가능한 지점
                      {savingScopeId === cleaner.id && (
                        <span className="text-white/30 normal-case tracking-normal">저장 중…</span>
                      )}
                    </label>
                    {!cleaner.userId ? (
                      <p className="text-xs text-white/40">로그인 계정을 먼저 만들어 주세요.</p>
                    ) : properties.length === 0 ? (
                      <p className="text-xs text-white/40">등록된 지점이 없습니다.</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {properties.map(p => {
                            const active = cleaner.assignedPropertyIds?.includes(p.id);
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => togglePropertyScope(cleaner, p.id)}
                                disabled={savingScopeId === cleaner.id}
                                className={`text-xs px-3 py-1.5 border tracking-wide transition-colors disabled:opacity-50 ${
                                  active
                                    ? 'bg-white text-black border-white'
                                    : 'bg-transparent text-white/60 border-white/15 hover:border-white/40 hover:text-white'
                                }`}
                              >
                                {p.name}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-white/30 mt-2 tracking-wide">
                          {cleaner.assignedPropertyIds?.length
                            ? `${cleaner.assignedPropertyIds.length}개 지점만 보입니다.`
                            : '지정 없음 — 모든 지점 표시'}
                        </p>
                      </>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">공개 캘린더 링크</label>
                    {cleaner.publicToken ? (
                      <div className="flex items-center gap-2">
                        <LinkIcon size={14} className="text-white/30 shrink-0" />
                        <input
                          type="text"
                          readOnly
                          value={publicUrl(cleaner.publicToken)}
                          onFocus={e => e.currentTarget.select()}
                          className="flex-1 bg-black/50 border border-white/10 px-4 py-2.5 text-xs text-white/70 focus:outline-none focus:border-white/30 transition-colors font-mono truncate"
                        />
                        <button
                          onClick={() => handleCopyLink(cleaner)}
                          className="p-2.5 border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors"
                          title="링크 복사"
                        >
                          {copiedId === cleaner.id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        </button>
                        <button
                          onClick={() => handleRegenerateToken(cleaner)}
                          disabled={regeneratingId === cleaner.id}
                          className="p-2.5 border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors disabled:opacity-50"
                          title="링크 재발급"
                        >
                          <RefreshCw size={14} className={regeneratingId === cleaner.id ? 'animate-spin' : ''} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleRegenerateToken(cleaner)}
                        disabled={regeneratingId === cleaner.id}
                        className="text-xs text-white/50 hover:text-white flex items-center gap-2 border border-white/10 px-3 py-2 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw size={12} />
                        링크 발급
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-5">
                  <button
                    onClick={() => handleDelete(cleaner.id)}
                    className="p-2 text-white/30 hover:text-red-400 transition-colors"
                    title="삭제"
                  >
                    <Trash2 size={16} strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => handleUpdate(cleaner)}
                    disabled={saving === cleaner.id}
                    className="flex items-center gap-2 bg-white/10 hover:bg-white hover:text-black text-white px-4 py-2 text-[10px] tracking-widest font-semibold transition-colors disabled:opacity-50"
                  >
                    <Save size={13} />
                    {saving === cleaner.id ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
