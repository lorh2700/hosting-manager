'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Link2, Plus, RefreshCw, Trash2, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import type { IntegrationProvider, IntegrationType, IntegrationStatus } from '@/lib/types';
import { toast, confirmDialog } from '@/components/ui';

interface IntegrationRecord {
  id: string;
  propertyId: string;
  propertyName?: string;
  provider: IntegrationProvider;
  type: IntegrationType;
  config: Record<string, string>;
  status: IntegrationStatus;
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'failed';
  lastErrorMessage?: string;
  syncIntervalMinutes: number;
  createdAt: string;
}

interface SyncLogRecord {
  id: string;
  propertyId: string;
  channelId: string;
  type: string;
  status: string;
  eventsFound: number;
  eventsCreated: number;
  eventsUpdated: number;
  eventsRemoved: number;
  errorMessage?: string;
  durationMs: number;
  createdAt: string;
}

const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  airbnb: 'Airbnb',
  booking: 'Booking.com',
  beds24: 'Beds24',
  stayfolio: 'Stayfolio',
  agoda: 'Agoda',
  naver: 'Naver',
};

const STATUS_ICONS: Record<IntegrationStatus, React.ReactNode> = {
  active: <CheckCircle2 size={14} className="text-emerald-600" />,
  inactive: <Clock size={14} className="text-stone-400" />,
  error: <XCircle size={14} className="text-red-600" />,
};

export default function IntegrationsPage() {
  const { user, profile } = useAuth();
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLogRecord[]>([]);
  const [properties, setProperties] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // Add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPropertyId, setNewPropertyId] = useState('');
  const [newProvider, setNewProvider] = useState<IntegrationProvider>('airbnb');
  const [newType, setNewType] = useState<IntegrationType>('ical');
  const [newImportUrl, setNewImportUrl] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        // Fetch properties
        const propsRes = await fetch('/api/properties');
        const propsData = propsRes.ok ? await propsRes.json() : [];
        const propsMap = new Map<string, string>();
        propsData.forEach((p: any) => propsMap.set(p.id, p.name));
        setProperties(propsMap);

        const propIds = Array.from(propsMap.keys());
        if (propIds.length === 0) { setLoading(false); return; }

        // Fetch integrations
        const intRes = await fetch('/api/integrations');
        const intData = intRes.ok ? await intRes.json() : [];
        const allIntegrations: IntegrationRecord[] = intData.map((i: any) => ({
          ...i,
          propertyName: propsMap.get(i.propertyId),
        }));
        setIntegrations(allIntegrations);

        // Fetch recent sync logs
        const logsRes = await fetch('/api/integrations?type=sync_logs&limit=50');
        if (logsRes.ok) {
          const logsData = await logsRes.json();
          setSyncLogs(logsData);
        }

        if (propIds.length > 0 && !newPropertyId) {
          setNewPropertyId(propIds[0]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, profile]);

  const handleSyncAll = async () => {
    if (!user) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggeredBy: user.id }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`동기화 완료: ${data.summary.eventsCreated}건 생성, ${data.summary.eventsUpdated}건 업데이트, ${data.summary.eventsRemoved}건 삭제`);
        // Reload
        window.location.reload();
      } else {
        toast.error('동기화 실패: ' + (data.error || '알 수 없는 오류'));
      }
    } catch (err) {
      console.error(err);
      toast.error('동기화 중 오류가 발생했습니다.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncOne = async (integration: IntegrationRecord) => {
    if (!user) return;
    setSyncingId(integration.id);
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: integration.propertyId, triggeredBy: user.id }),
      });
      const data = await res.json();
      if (data.success) {
        const detail = data.details?.find((d: { integrationId: string }) => d.integrationId === integration.id);
        if (detail) {
          toast.success(`${PROVIDER_LABELS[integration.provider]} 동기화 완료: ${detail.result.eventsCreated}건 생성, ${detail.result.eventsUpdated}건 업데이트`);
        }
        window.location.reload();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSyncingId(null);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newPropertyId) return;
    setAdding(true);

    try {
      const now = new Date().toISOString();
      const integration = {
        propertyId: newPropertyId,
        provider: newProvider,
        type: newType,
        config: { importUrl: newImportUrl },
        status: 'active' as const,
        syncIntervalMinutes: 15,
        createdAt: now,
        updatedAt: now,
      };

      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(integration),
      });
      if (!res.ok) throw new Error('Failed to add integration');
      const data = await res.json();
      setIntegrations(prev => [...prev, {
        id: data.id,
        ...integration,
        propertyName: properties.get(newPropertyId),
      }]);
      setShowAddForm(false);
      setNewImportUrl('');
    } catch (err) {
      console.error(err);
      toast.error('추가에 실패했습니다.');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog('이 연동을 삭제하시겠습니까?'))) return;
    try {
      const res = await fetch(`/api/integrations?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setIntegrations(prev => prev.filter(i => i.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleStatus = async (integration: IntegrationRecord) => {
    const newStatus: IntegrationStatus = integration.status === 'active' ? 'inactive' : 'active';
    try {
      const res = await fetch('/api/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: integration.id,
          status: newStatus,
          updatedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error('Failed to update');
      setIntegrations(prev => prev.map(i => i.id === integration.id ? { ...i, status: newStatus } : i));
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-[var(--brand)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-12">
      <header className="border-b border-stone-200 pb-8 flex flex-col sm:flex-row gap-4 sm:justify-between sm:items-end">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-stone-500 mb-4">채널</p>
          <h1 className="text-3xl md:text-4xl font-light tracking-tight text-stone-900">연동 관리</h1>
          <p className="text-stone-500 mt-4 text-sm font-light tracking-wide">OTA 채널 연동 및 동기화 상태를 관리합니다.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 bg-stone-100 text-stone-900 px-4 py-2.5 text-[11px] uppercase tracking-widest font-semibold hover:bg-stone-200 transition-colors"
          >
            <Plus size={14} />
            연동 추가
          </button>
          <button
            onClick={handleSyncAll}
            disabled={syncing}
            className="flex items-center gap-2 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white px-6 py-2.5 text-[11px] uppercase tracking-widest font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? '동기화 중...' : '전체 동기화'}
          </button>
        </div>
      </header>

      {/* Add Form */}
      {showAddForm && (
        <form onSubmit={handleAdd} className="bg-white border border-stone-300 p-6 space-y-4">
          <h2 className="text-sm font-medium text-stone-900 mb-4">새 연동 추가</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">숙소</label>
              <select
                value={newPropertyId}
                onChange={e => setNewPropertyId(e.target.value)}
                className="w-full bg-white border border-stone-200 text-stone-900 text-sm px-4 py-2.5 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15"
              >
                {Array.from(properties).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">채널</label>
              <select
                value={newProvider}
                onChange={e => setNewProvider(e.target.value as IntegrationProvider)}
                className="w-full bg-white border border-stone-200 text-stone-900 text-sm px-4 py-2.5 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15"
              >
                {Object.entries(PROVIDER_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">연동 유형</label>
              <select
                value={newType}
                onChange={e => setNewType(e.target.value as IntegrationType)}
                className="w-full bg-white border border-stone-200 text-stone-900 text-sm px-4 py-2.5 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15"
              >
                <option value="ical">iCal</option>
                <option value="api">API</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">iCal Import URL</label>
            <input
              type="url"
              value={newImportUrl}
              onChange={e => setNewImportUrl(e.target.value)}
              className="w-full bg-white border border-stone-200 px-4 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15"
              placeholder="https://www.airbnb.co.kr/calendar/ical/..."
            />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-[10px] text-stone-500 hover:text-stone-900">
              취소
            </button>
            <button
              type="submit"
              disabled={adding}
              className="bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white px-6 py-2 text-[10px] tracking-widest font-semibold uppercase disabled:opacity-50"
            >
              {adding ? '추가 중...' : '추가'}
            </button>
          </div>
        </form>
      )}

      {/* Integrations List */}
      {integrations.length === 0 ? (
        <div className="bg-white border border-stone-200 p-12 text-center flex flex-col items-center text-stone-400">
          <Link2 size={32} className="mb-4 opacity-50" />
          <p className="text-sm">등록된 연동이 없습니다.</p>
          <p className="text-xs mt-2">위의 &quot;연동 추가&quot; 버튼으로 OTA 채널을 연결하세요.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {integrations.map(integ => (
            <div key={integ.id} className={`bg-white border p-5 transition-colors ${
              integ.status === 'error' ? 'border-red-300' :
              integ.status === 'inactive' ? 'border-stone-100' :
              'border-stone-200 hover:border-stone-300'
            }`}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  {STATUS_ICONS[integ.status]}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-stone-900 text-sm font-medium">{PROVIDER_LABELS[integ.provider]}</span>
                      <span className="text-stone-400 text-xs">{integ.type.toUpperCase()}</span>
                      {integ.propertyName && (
                        <span className="text-stone-500 text-xs">&middot; {integ.propertyName}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-stone-500">
                      {integ.lastSyncAt && (
                        <span>마지막 동기화: {new Date(integ.lastSyncAt).toLocaleString('ko-KR')}</span>
                      )}
                      {integ.lastSyncStatus === 'failed' && integ.lastErrorMessage && (
                        <span className="text-red-600 flex items-center gap-1">
                          <AlertTriangle size={10} />
                          {integ.lastErrorMessage.substring(0, 60)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSyncOne(integ)}
                    disabled={syncingId === integ.id || integ.status === 'inactive'}
                    className="p-2 text-stone-500 hover:text-stone-900 transition-colors disabled:opacity-30"
                    title="동기화"
                  >
                    <RefreshCw size={14} className={syncingId === integ.id ? 'animate-spin' : ''} />
                  </button>
                  <button
                    onClick={() => handleToggleStatus(integ)}
                    className={`px-3 py-1 text-[9px] tracking-widest border transition-colors ${
                      integ.status === 'active'
                        ? 'border-emerald-300 text-emerald-600 hover:bg-emerald-50'
                        : 'border-stone-200 text-stone-500 hover:bg-stone-100'
                    }`}
                  >
                    {integ.status === 'active' ? '활성' : '비활성'}
                  </button>
                  <button
                    onClick={() => handleDelete(integ.id)}
                    className="p-2 text-stone-300 hover:text-red-600 transition-colors"
                    title="삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sync Logs */}
      {syncLogs.length > 0 && (
        <div>
          <h2 className="text-[10px] uppercase tracking-widest text-stone-500 mb-4">최근 동기화 이력</h2>
          <div className="bg-white border border-stone-200 overflow-hidden">
            <div className="divide-y divide-stone-100">
              {syncLogs.slice(0, 20).map(log => (
                <div key={log.id} className="px-5 py-3 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    {log.status === 'success' ? (
                      <CheckCircle2 size={12} className="text-emerald-600" />
                    ) : log.status === 'failed' ? (
                      <XCircle size={12} className="text-red-600" />
                    ) : (
                      <AlertTriangle size={12} className="text-amber-500" />
                    )}
                    <span className="text-stone-700">
                      {properties.get(log.propertyId) ?? log.propertyId}
                    </span>
                    {log.errorMessage && (
                      <span className="text-red-600/80 truncate max-w-[200px]">{log.errorMessage}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-stone-400">
                    <span>+{log.eventsCreated} / ~{log.eventsUpdated} / -{log.eventsRemoved}</span>
                    <span>{log.durationMs}ms</span>
                    <span>{new Date(log.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
