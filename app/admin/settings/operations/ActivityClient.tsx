'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { NavigationLink } from '@/components/NavigationFeedback';
import { OPERATIONAL_MODULES } from '@/lib/operational-permissions';
import { localDate, operationsApi, type OperationsSnapshot } from './types';
import styles from './OperationsSettings.module.css';

interface ActivityItem {
  id: string; createdAt: string; actorId: string | null; actorName: string | null;
  action: string; module: string | null; targetType: string | null; targetId: string | null;
  propertyId: string | null; organizationId: string | null; summary: string;
  outcome: string; requestId: string | null; details: Record<string, unknown> | null;
}
interface ActivityResponse { items: ActivityItem[]; hasMore: boolean; nextCursor: string | null }
interface Filters { organizationId: string; propertyId: string; actorId: string; module: string; outcome: string; from: string; to: string; search: string }
const dateString = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const initialFilters = (): Filters => ({ organizationId: '', propertyId: '', actorId: '', module: '', outcome: '', from: dateString(new Date(Date.now() - 6 * 86400000)), to: dateString(new Date()), search: '' });
const outcomeLabels: Record<string, string> = { success: '성공', denied: '권한 거부', failed: '실패' };

export default function ActivityClient() {
  const { user, profile, loading: authLoading } = useAuth();
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [applied, setApplied] = useState<Filters>(initialFilters);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestRequest = useRef(0);
  const isSuper = String(profile?.role) === 'super_admin';
  const canRead = isSuper || profile?.role === 'admin';
  const load = useCallback(async (criteria: Filters, nextCursor?: string) => {
    const run = ++latestRequest.current;
    setLoading(true); setError('');
    if (!nextCursor) { setItems([]); setCursor(null); setHasMore(false); }
    const params = new URLSearchParams({ pageSize: '50' });
    for (const [key, value] of Object.entries(criteria)) if (value) params.set(key, value);
    if (nextCursor) params.set('cursor', nextCursor);
    try {
      const result = await operationsApi<ActivityResponse>(`/api/admin/activity?${params}`);
      if (run !== latestRequest.current) return;
      setItems(current => nextCursor ? [...current, ...result.items.filter(item => !current.some(old => old.id === item.id))] : result.items);
      setCursor(result.nextCursor); setHasMore(result.hasMore);
    } catch (cause) { if (run === latestRequest.current) setError(cause instanceof Error ? cause.message : '활동 로그를 불러오지 못했습니다.'); }
    finally { if (run === latestRequest.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!user || !canRead) { if (!authLoading) setLoading(false); return; }
    void load(initialFilters());
    operationsApi<OperationsSnapshot>('/api/admin/operations-settings').then(setSnapshot).catch(cause => setError(cause instanceof Error ? cause.message : '조회 범위를 불러오지 못했습니다.'));
  }, [user, canRead, authLoading, load]);
  const setFilter = (key: keyof Filters, value: string) => setFilters(current => ({ ...current, [key]: value, ...(key === 'organizationId' ? { propertyId: '', actorId: '' } : {}) }));
  const properties = snapshot?.properties.filter(item => !filters.organizationId || item.organizationId === filters.organizationId) || [];
  const users = snapshot?.users.filter(item => !filters.organizationId || item.organizationId === filters.organizationId) || [];

  return <div className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>운영 기록</p><h1>활동 로그</h1><p>누가 설정을 변경하거나 업무를 처리했는지 확인합니다. 화면의 시간은 한국 시간 기준입니다.</p></div><div className={styles.toolbar}><NavigationLink className={styles.link} href="/admin/settings"><ArrowLeft size={14} />설정으로</NavigationLink>{canRead && <button type="button" disabled={loading} onClick={() => void load(applied)}><RefreshCw size={14} />새로고침</button>}</div></header>
    {!canRead && !authLoading ? <div className={styles.info}>활동 로그는 사업자 관리자와 슈퍼매니저가 조회할 수 있습니다.</div> : <>
      <form className={styles.filters} onSubmit={event => { event.preventDefault(); setApplied(filters); void load(filters); }}>
        {isSuper && <label className={styles.field}>사업자<select value={filters.organizationId} onChange={event => setFilter('organizationId', event.target.value)}><option value="">모든 사업자</option>{snapshot?.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <label className={styles.field}>지점<select value={filters.propertyId} onChange={event => setFilter('propertyId', event.target.value)}><option value="">모든 담당 지점</option>{properties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className={styles.field}>사용자<select value={filters.actorId} onChange={event => setFilter('actorId', event.target.value)}><option value="">모든 사용자</option>{users.map(item => <option key={item.id} value={item.id}>{item.displayName || item.email}</option>)}</select></label>
        <label className={styles.field}>메뉴<select value={filters.module} onChange={event => setFilter('module', event.target.value)}><option value="">모든 메뉴</option>{OPERATIONAL_MODULES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <label className={styles.field}>결과<select value={filters.outcome} onChange={event => setFilter('outcome', event.target.value)}><option value="">모든 결과</option>{Object.entries(outcomeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className={styles.field}>시작일<input type="date" required max={filters.to} value={filters.from} onChange={event => setFilter('from', event.target.value)} /></label>
        <label className={styles.field}>종료일<input type="date" required min={filters.from} value={filters.to} onChange={event => setFilter('to', event.target.value)} /></label>
        <label className={styles.field}>내용 검색<input type="search" value={filters.search} onChange={event => setFilter('search', event.target.value)} placeholder="활동 내용 또는 기능" maxLength={200} /></label>
        <div className={`${styles.actions} self-end`}><button type="submit" className={styles.primary} disabled={loading}><Search size={14} />조회</button><button type="button" disabled={loading} onClick={() => { const next = initialFilters(); setFilters(next); setApplied(next); void load(next); }}>초기화</button></div>
      </form>
      {error && <div role="alert" className={styles.error}>{error}</div>}
      <div className={styles.sectionTitle}><p className={styles.muted}>{applied.from} ~ {applied.to} · {items.length}건 표시{hasMore ? ' · 이전 기록 더 있음' : ''}</p></div>
      {loading && !items.length ? <div role="status" className={styles.loading}>활동 로그를 불러오는 중…</div> : <div className={styles.log}>{items.map(item => <article key={item.id}><time dateTime={item.createdAt}>{localDate(item.createdAt)}</time><div><h2>{item.summary || item.action}</h2><p>{item.actorName || '시스템'} · {OPERATIONAL_MODULES.find(module => module.key === item.module)?.label || '운영 설정'}{item.organizationId && ` · ${snapshot?.organizations.find(org => org.id === item.organizationId)?.name || '사업자'}`}{item.propertyId && ` · ${snapshot?.properties.find(p => p.id === item.propertyId)?.name || '숙소'}`}</p>{item.details && Object.keys(item.details).length > 0 && <details><summary>상세 기록</summary><pre>{JSON.stringify(item.details, null, 2)}</pre>{item.requestId && <p>기록 식별자: {item.requestId}</p>}</details>}</div><span className={styles.badge} data-status={item.outcome}>{outcomeLabels[item.outcome] || item.outcome}</span></article>)}</div>}
      {!loading && !items.length && !error && <div className={styles.empty}>선택한 기간에 해당하는 활동 기록이 없습니다.</div>}
      {hasMore && <div className={styles.footer}><button type="button" disabled={loading || !cursor} onClick={() => { if (cursor) void load(applied, cursor); }}>{loading ? '불러오는 중…' : '이전 기록 더 보기'}</button></div>}
    </>}
  </div>;
}
