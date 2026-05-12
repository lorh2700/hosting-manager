'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Copy, Check, Ban, KeyRound, Plus, X } from 'lucide-react';

interface ApiClientRecord {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  propertyIds: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface Property {
  id: string;
  name: string;
}

const ALLOWED_SCOPES = [
  { key: 'properties:read', label: '지점 조회' },
  { key: 'bookings:read',   label: '예약 조회' },
  { key: 'cleanings:read',  label: '청소 조회' },
  { key: 'cleanings:write', label: '청소 생성/수정' },
];

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ApiClientsPage() {
  const { profile } = useAuth();
  const [clients, setClients] = useState<ApiClientRecord[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Newly created — show plaintext key once
  const [newKey, setNewKey] = useState<{ name: string; plaintextKey: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const isSuperAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';

  useEffect(() => {
    if (!isSuperAdmin) return;
    (async () => {
      try {
        const [cRes, pRes] = await Promise.all([
          fetch('/api/admin/api-clients'),
          fetch('/api/properties'),
        ]);
        if (cRes.ok) setClients(await cRes.json());
        if (pRes.ok) setProperties(await pRes.json());
      } finally {
        setLoading(false);
      }
    })();
  }, [isSuperAdmin]);

  const resetForm = () => {
    setName(''); setScopes([]); setPropertyIds([]); setExpiresAt('');
    setError(''); setShowForm(false);
  };

  const toggleScope = (s: string) => {
    setScopes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };
  const togglePropertyId = (id: string) => {
    setPropertyIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const create = async () => {
    if (creating) return;
    if (!name.trim()) { setError('파트너사 이름을 입력해주세요.'); return; }
    if (scopes.length === 0) { setError('스코프를 1개 이상 선택해주세요.'); return; }
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/admin/api-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          propertyIds,
          expiresAt: expiresAt || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '생성 실패'); return; }
      setNewKey({ name: data.name, plaintextKey: data.plaintextKey });
      setClients(prev => [{ ...data, plaintextKey: undefined } as ApiClientRecord, ...prev]);
      resetForm();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm('이 API 키를 회수합니다. 사용 중인 파트너의 호출이 즉시 차단됩니다. 계속할까요?')) return;
    const res = await fetch(`/api/admin/api-clients/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setClients(prev => prev.map(c => c.id === id ? { ...c, revokedAt: new Date().toISOString() } : c));
    } else {
      alert('회수 실패');
    }
  };

  const copyKey = () => {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey.plaintextKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isSuperAdmin) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <p className="text-stone-500 text-sm">슈퍼 관리자만 접근할 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">Integrations</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-stone-900 tracking-tight">API 클라이언트</h1>
        <p className="text-stone-500 text-sm mt-2">
          외부 파트너사 (스테이폴리오 등) 가 v1 API 를 호출할 때 사용할 키 관리.
          <span className="text-stone-300 mx-1">·</span>
          <a href="/api-docs" target="_blank" rel="noopener" className="text-[var(--brand)] hover:underline">
            API 문서 (Swagger UI) ↗
          </a>
        </p>
      </header>

      {/* One-time key reveal modal */}
      {newKey && (
        <div className="fixed inset-0 bg-stone-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 max-w-lg w-full">
            <div className="px-6 py-5 border-b border-stone-200 flex items-start gap-3">
              <KeyRound size={20} className="text-[var(--brand)] mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-stone-900">{newKey.name} — 키 발급 완료</p>
                <p className="text-xs text-stone-500 mt-1">
                  이 키는 <strong>지금 한 번만</strong> 표시됩니다. 안전한 곳에 복사해 두세요.
                  창을 닫으면 다시 볼 수 없습니다 (해시만 저장).
                </p>
              </div>
              <button onClick={() => setNewKey(null)} className="text-stone-500 hover:text-stone-900" aria-label="닫기">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <div className="bg-stone-50 border border-stone-200 p-3 font-mono text-xs break-all text-stone-900">
                {newKey.plaintextKey}
              </div>
              <button
                onClick={copyKey}
                className="mt-3 w-full bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white py-2.5 text-xs font-semibold uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
              >
                {copied ? <><Check size={14} /> 복사됨</> : <><Copy size={14} /> 클립보드로 복사</>}
              </button>
              <p className="text-[11px] text-stone-500 mt-3">
                파트너사에 <code className="bg-stone-100 px-1">Authorization: Bearer {newKey.plaintextKey.slice(0, 12)}…</code> 형식으로 전달하라고 안내하세요.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Create button / form */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white px-4 py-2.5 text-xs font-semibold uppercase tracking-widest transition-colors inline-flex items-center gap-2"
        >
          <Plus size={14} /> 새 API 키 발급
        </button>
      ) : (
        <div className="bg-white border border-stone-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-stone-900">새 API 키 발급</h2>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-600 mb-2">파트너사 이름</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: 스테이폴리오"
              className="w-full bg-white border border-stone-300 px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--brand)]"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-600 mb-2">스코프 (권한)</label>
            <div className="grid grid-cols-2 gap-2">
              {ALLOWED_SCOPES.map(s => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggleScope(s.key)}
                  className={`px-3 py-2 border text-xs text-left transition-colors ${
                    scopes.includes(s.key)
                      ? 'bg-[var(--brand-tint)] border-[var(--brand)] text-[var(--brand-dark)]'
                      : 'bg-white border-stone-300 text-stone-600 hover:border-stone-400'
                  }`}
                >
                  <span className="block font-mono text-[10px]">{s.key}</span>
                  <span className="block text-[11px] mt-0.5">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-600 mb-2">
              지점 제한
            </label>
            <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
              <strong>아무것도 선택하지 않으면 모든 지점 접근 가능</strong> — 대부분의 경우 비워두세요.
              특정 지점만 노출하려는 경우에만 선택. ({propertyIds.length === 0
                ? `현재: 모든 지점 (${properties.length}개) 접근 가능`
                : `현재: ${propertyIds.length}개 지점만 접근 가능`})
            </p>
            <div className="flex flex-wrap gap-2">
              {properties.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePropertyId(p.id)}
                  className={`px-3 py-1.5 border text-xs transition-colors ${
                    propertyIds.includes(p.id)
                      ? 'bg-[var(--brand-tint)] border-[var(--brand)] text-[var(--brand-dark)]'
                      : 'bg-white border-stone-300 text-stone-600 hover:border-stone-400'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-600 mb-2">만료일 (선택)</label>
            <input
              type="date"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
              className="bg-white border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:border-[var(--brand)]"
            />
          </div>

          {error && <p className="text-rose-600 text-xs">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              onClick={create}
              disabled={creating}
              className="bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white px-4 py-2.5 text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-50"
            >
              {creating ? '생성 중...' : '발급'}
            </button>
            <button
              onClick={resetForm}
              className="bg-white border border-stone-300 text-stone-700 hover:border-stone-400 px-4 py-2.5 text-xs font-semibold uppercase tracking-widest transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* Existing clients */}
      <div className="bg-white border border-stone-200">
        <div className="px-5 py-4 border-b border-stone-200">
          <p className="text-sm font-semibold text-stone-900">발급된 키 ({clients.length})</p>
        </div>
        {loading ? (
          <div className="px-5 py-8 text-center text-stone-400 text-sm">불러오는 중...</div>
        ) : clients.length === 0 ? (
          <div className="px-5 py-8 text-center text-stone-400 text-sm">발급된 키가 없습니다.</div>
        ) : (
          <div className="divide-y divide-stone-200">
            {clients.map(c => {
              const isRevoked = !!c.revokedAt;
              const isExpired = c.expiresAt && new Date(c.expiresAt).getTime() < Date.now();
              const stateLabel = isRevoked ? '회수됨' : isExpired ? '만료됨' : '활성';
              const stateCls = isRevoked || isExpired
                ? 'bg-stone-100 text-stone-500'
                : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
              return (
                <div key={c.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-stone-900">{c.name}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-widest ${stateCls}`}>
                        {stateLabel}
                      </span>
                    </div>
                    <p className="text-xs text-stone-500 mt-0.5 font-mono">{c.keyPrefix}…</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {c.scopes.map(s => (
                        <span key={s} className="text-[10px] bg-stone-100 px-1.5 py-0.5 font-mono">{s}</span>
                      ))}
                    </div>
                    <p className="text-[11px] text-stone-500 mt-1.5">
                      <strong>지점:</strong>{' '}
                      {c.propertyIds.length === 0
                        ? <span className="text-emerald-700">모든 지점</span>
                        : c.propertyIds
                            .map((id) => properties.find((p) => p.id === id)?.name ?? id.slice(0, 8))
                            .join(', ')}
                    </p>
                    <p className="text-[11px] text-stone-400 mt-1">
                      마지막 사용 {fmtDate(c.lastUsedAt)} · 발급 {fmtDate(c.createdAt)}
                      {c.expiresAt && ` · 만료 ${fmtDate(c.expiresAt)}`}
                    </p>
                  </div>
                  {!isRevoked && (
                    <button
                      onClick={() => revoke(c.id)}
                      className="text-rose-600 hover:text-rose-800 text-xs inline-flex items-center gap-1.5 transition-colors shrink-0"
                    >
                      <Ban size={14} /> 회수
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
