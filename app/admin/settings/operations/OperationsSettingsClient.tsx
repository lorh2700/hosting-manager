'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Building2, ChevronRight, Clipboard, History, Plus, RefreshCw, Save, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { NavigationLink } from '@/components/NavigationFeedback';
import { OPERATIONAL_MODULES, normalizeModuleGrants, type OperationalModule } from '@/lib/operational-permissions';
import { operationsApi, roleLabels, statusLabels, localDate, type OperationsSnapshot, type Organization, type ManagedProperty, type ManagedUser, type FeatureValues, type PropertyRequest } from './types';
import styles from './OperationsSettings.module.css';
import { createPreviewOperationsApi, createPreviewStore } from './preview-data';
import { DraftGuardProvider, useDraftGuard, useDraftTransition } from './DraftGuard';

const OperationsApiContext = createContext(operationsApi);
const PreviewContext = createContext(false);

function OperationalLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const preview = useContext(PreviewContext);
  return preview ? <button type="button" disabled className={className} title="시안에서는 실제 관리 화면으로 이동하지 않습니다.">{children}</button> : <NavigationLink href={href} className={className}>{children}</NavigationLink>;
}

type Tab = 'organizations' | 'users' | 'features' | 'requests';
const tabs: { key: Tab; label: string }[] = [
  { key: 'organizations', label: '사업자·지점' }, { key: 'users', label: '사용자·권한' },
  { key: 'features', label: '운영 기능' }, { key: 'requests', label: '지점 요청' },
];
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '처리하지 못했습니다. 다시 시도해 주세요.';

function SaveBar({ dirty, saving, onReset, sticky = false }: { dirty: boolean; saving: boolean; onReset: () => void; sticky?: boolean }) {
  return <div className={`${styles.saveBar} ${sticky ? styles.stickySaveBar : ''}`}>
    <p aria-live="polite">{dirty ? '저장하지 않은 변경사항이 있습니다.' : '저장된 설정입니다.'}</p>
    <div className={styles.actions}>
      <button type="button" disabled={!dirty || saving} onClick={onReset}>변경 취소</button>
      <button type="submit" className={styles.primary} disabled={!dirty || saving}><Save size={14} />{saving ? '저장 중…' : '변경 저장'}</button>
    </div>
  </div>;
}

export default function OperationsSettingsClient({ preview = false }: { preview?: boolean }) {
  return <DraftGuardProvider>{preview ? <PreviewSettings /> : <SettingsWorkspace />}</DraftGuardProvider>;
}

function PreviewSettings() {
  const [role, setRole] = useState('super_admin');
  const transition = useDraftTransition();
  const [store] = useState(createPreviewStore);
  const previewApi = useMemo(() => createPreviewOperationsApi(store, role), [store, role]);
  return <PreviewContext.Provider value><OperationsApiContext.Provider value={previewApi}>
    <div className={styles.page}><div className={`${styles.info} mb-6`}><strong>설정 화면 시안 · 예시 데이터</strong><p className={styles.muted}>저장과 초대는 이 화면의 임시 데이터에만 반영됩니다. 실제 사업자, 직원, 숙소 설정은 변경되지 않습니다.</p><div className={`${styles.actions} mt-3`}><NavigationLink href="/admin/settings" className={styles.link}>내 숙소의 실제 설정 열기 <ChevronRight size={14} /></NavigationLink></div><div className={`${styles.actions} mt-3`} role="group" aria-label="시안 역할 선택">{['super_admin', 'admin', 'manager', 'cleaner'].map(value => <button type="button" key={value} aria-pressed={role === value} className={role === value ? styles.primary : undefined} onClick={() => { if (value !== role) transition(() => setRole(value)); }}>{roleLabels[value]}</button>)}</div></div></div>
    <SettingsWorkspace previewRole={role} />
  </OperationsApiContext.Provider></PreviewContext.Provider>;
}

function SettingsWorkspace({ previewRole }: { previewRole?: string }) {
  const operationsApi = useContext(OperationsApiContext);
  const transition = useDraftTransition();
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>('organizations');
  const [organizationId, setOrganizationId] = useState('');
  const [scopeReady, setScopeReady] = useState(false);
  const [scopeRetry, setScopeRetry] = useState(0);
  const [organizationChoices, setOrganizationChoices] = useState<Organization[]>([]);
  const [featureScope, setFeatureScope] = useState<'organization' | 'property'>('organization');
  const [featurePropertyId, setFeaturePropertyId] = useState('');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const role = previewRole || String(profile?.role || snapshot?.viewer.role || '');
  const isSuper = role === 'super_admin';
  const canConfigure = role === 'admin' || isSuper;
  const scopeIdentity = previewRole || user?.id || '';
  const scopeAuthLoading = !previewRole && authLoading;
  const scopeOrganizationId = previewRole ? null : profile?.organizationId;
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const initialTab = search.get('tab');
    if (tabs.some(item => item.key === initialTab)) setTab(initialTab as Tab);
  }, []);

  useEffect(() => {
    if (!scopeIdentity || !canConfigure) { if (!scopeAuthLoading) setLoading(false); return; }
    let current = true; setScopeReady(false); setLoading(true); setError('');
    if (!isSuper) {
      setOrganizationId(previewRole ? 'preview-company-a' : scopeOrganizationId || '');
      setFeatureScope('property'); setScopeReady(true); return;
    }
    void operationsApi<{ organizations: Organization[] }>('/api/admin/organizations?picker=1').then(result => {
      if (!current) return;
      setOrganizationChoices(result.organizations);
      const search = new URLSearchParams(window.location.search);
      const requested = search.get('organizationId') || search.get('orgId');
      setOrganizationId(requested === '__unassigned__' || result.organizations.some(item => item.id === requested) ? requested! : result.organizations.find(item => item.status === 'active')?.id || '__unassigned__');
      setScopeReady(true);
    }).catch(cause => { if (current) { setError(errorMessage(cause)); setLoading(false); } });
    return () => { current = false; };
  }, [scopeIdentity, canConfigure, scopeAuthLoading, isSuper, operationsApi, previewRole, scopeOrganizationId, scopeRetry]);
  const load = useCallback(async (requestedScope = organizationId) => {
    const run = ++latestRequest.current; setLoading(true); setError('');
    const params = new URLSearchParams(); if (isSuper && requestedScope) params.set('organizationId', requestedScope);
    try {
      const result = await operationsApi<OperationsSnapshot>(`/api/admin/operations-settings${params.size ? `?${params}` : ''}`);
      if (run !== latestRequest.current) return;
      setSnapshot(result); setOrganizationChoices(result.organizations);
    } catch (cause) { if (run === latestRequest.current) setError(errorMessage(cause)); }
    finally { if (run === latestRequest.current) setLoading(false); }
  }, [operationsApi, organizationId, isSuper]);
  useEffect(() => { if (scopeReady && canConfigure) void load(); return () => { latestRequest.current += 1; }; }, [scopeReady, canConfigure, load]);
  const retryLoad = () => { if (!scopeReady) setScopeRetry(value => value + 1); else void load(); };
  const changed = async (message = '변경사항을 저장했습니다.') => { await load(); if (!previewRole) await refreshProfile(); setNotice(message); };
  const organizations = snapshot?.organizations.filter(item => !organizationId || item.id === organizationId) || [];
  const inScope = (id: string | null) => !organizationId || (organizationId === '__unassigned__' ? !id : id === organizationId);
  const properties = snapshot?.properties.filter(item => inScope(item.organizationId)) || [];
  const users = snapshot?.users.filter(item => inScope(item.organizationId) && `${item.displayName} ${item.email}`.toLowerCase().includes(query.trim().toLowerCase())) || [];
  const currentUser = snapshot?.users.find(item => item.id === selectedUser);
  const featureProperty = properties.find(item => item.id === featurePropertyId) || properties[0];

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>운영 설정</p><h1>사업자·권한 설정</h1><p>{isSuper ? '사업자를 초대하고 지점, 사용자, 제공 기능을 관리합니다.' : '우리 사업자의 지점, 담당자와 운영 기능을 한곳에서 관리합니다.'}</p></div>
      <div className={styles.toolbar}>{!previewRole && <NavigationLink href="/admin/settings/profile" className={styles.link}>내 프로필</NavigationLink>}{canConfigure && <>{previewRole ? <button type="button" disabled><History size={15} />활동 로그</button> : <NavigationLink href="/admin/activity" className={styles.link}><History size={15} />활동 로그</NavigationLink>}<button type="button" onClick={() => transition(retryLoad)} disabled={loading}><RefreshCw size={14} />{loading ? '불러오는 중…' : '새로고침'}</button></>}</div>
    </header>
    {!canConfigure && !authLoading ? <div className={styles.info}>사업자·권한 설정은 사업자 관리자와 슈퍼매니저가 관리합니다. 담당 숙소와 메뉴 권한 변경은 사업자 관리자에게 요청해 주세요.</div> : <>
      {error && <div role="alert" className={styles.error}>{error}<div className={styles.actions}><button type="button" onClick={retryLoad} disabled={loading}>다시 불러오기</button></div></div>}
      {notice && <div role="status" className={styles.notice}>{notice}</div>}
      {loading && !snapshot || (previewRole && snapshot?.viewer.role !== previewRole) ? <div role="status" className={styles.loading}>사업자와 권한 설정을 불러오는 중…</div> : snapshot && <div inert={loading || !!error} aria-busy={loading}>
        {isSuper && snapshot.organizations.length === 0 && <div className={`${styles.info} mb-5`}><strong>기존 숙소의 사업자 소속을 설정해 주세요.</strong><p>사업자 미배정 숙소 {properties.length}개가 있습니다. 사업자를 추가한 뒤, 해당 사업자의 ‘소속 지점’에서 기존 숙소를 선택해 연결할 수 있습니다. 담당 직원도 같은 사업자에 속해야 숙소와 권한이 정상적으로 표시됩니다.</p><div className={`${styles.actions} mt-3`}><button type="button" onClick={() => transition(() => { setTab('organizations'); setCreating(true); })}>사업자 설정 시작</button></div></div>}
        <div className={styles.scope}>
          <div><strong>{isSuper ? '슈퍼매니저' : organizations[0]?.name || '소속 사업자 확인 필요'}</strong><p>{isSuper ? '사업자별로 지점과 제공 기능을 구분합니다.' : '소속 사업자의 지점과 사용자만 표시됩니다. 지점 추가는 슈퍼매니저의 승인이 필요합니다.'}</p></div>
          {isSuper && <label>관리할 사업자<select value={organizationId} disabled={loading} onChange={event => { const next = event.target.value; transition(() => { setOrganizationId(next); setSelectedUser(null); setFeaturePropertyId(''); }); }} className={styles.field}>{organizationChoices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="__unassigned__">사업자 미배정 지점·사용자</option></select></label>}
        </div>
        <div className={styles.tabs} role="tablist" aria-label="운영 설정 항목">{tabs.map(item => <button key={item.key} type="button" role="tab" id={`tab-${item.key}`} aria-selected={tab === item.key} aria-controls={`panel-${item.key}`} onClick={() => { if (item.key !== tab) transition(() => { setTab(item.key); setNotice(''); }); }}>{item.label}</button>)}</div>
        <section id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className={styles.stack}>
          {tab === 'organizations' && <>
            <div className={styles.sectionTitle}><div><h2>사업자와 지점</h2><p>{organizations.length}개 사업자 · {properties.length}개 지점</p></div>{isSuper && <button type="button" className={styles.primary} onClick={() => { if (creating) transition(() => setCreating(false)); else setCreating(true); }}><Plus size={14} />사업자 추가</button>}</div>
            {creating && isSuper && <CreateOrganization onCreated={async id => { setCreating(false); setOrganizationId(id); await load(id); setNotice('사업자를 추가했습니다. 사업자 관리자를 초대해 주세요.'); }} onClose={() => transition(() => setCreating(false))} />}
            <div className={styles.grid}>{organizations.map(item => <OrganizationCard key={`${item.id}:${item.version}`} organization={item} organizations={organizationChoices} allProperties={snapshot.properties} isSuper={isSuper} onSaved={changed} />)}</div>
            {!organizations.length && <div className={styles.empty}>{isSuper ? organizationId === '__unassigned__' && snapshot.organizations.length > 0 ? '사업자에 연결되지 않은 숙소와 사용자입니다. 관리할 사업자를 선택하고 소속 지점에 연결해 주세요.' : '등록된 사업자가 없습니다. 사업자를 추가하고 기존 지점을 연결해 주세요.' : '계정의 소속 사업자를 먼저 설정해야 합니다. 슈퍼매니저에게 문의해 주세요.'}</div>}
            <div className={styles.sectionTitle}><div><h2>숙소 관리</h2><p>지점을 선택하면 주소, 체크인 안내와 운영 정보를 관리할 수 있습니다.</p></div><button type="button" onClick={() => transition(() => setTab('requests'))}><Plus size={14} />지점 추가 요청</button></div>
            <div className={styles.propertyList}>{properties.map(item => <article key={item.id} className={styles.property}><h3>{item.name}</h3><p>{snapshot.organizations.find(org => org.id === item.organizationId)?.name || '사업자 미배정'}</p><OperationalLink href={`/admin/properties/${item.id}/settings`}>숙소 설정 <ChevronRight size={11} className="inline" /></OperationalLink></article>)}</div>
            {!properties.length && <div className={styles.empty}>{isSuper ? organizationId === '__unassigned__' ? '사업자 미배정 숙소가 없습니다. 관리할 사업자를 선택해 소속 숙소를 확인해 주세요.' : '이 사업자에 연결된 숙소가 없습니다. 위 사업자 설정의 ‘소속 지점’에서 기존 숙소를 연결하거나 새 지점을 요청해 주세요.' : '소속 사업자에 연결된 숙소가 없습니다. 슈퍼매니저에게 기존 숙소 연결을 요청해 주세요.'}</div>}
          </>}
          {tab === 'users' && <>
            <div className={styles.sectionTitle}><div><h2>사용자와 메뉴 권한</h2><p>매니저는 배정 지점에서 허용된 메뉴를 관리하며, 청소 담당자는 청소와 현장 보고 기능을 사용합니다.</p></div><OperationalLink href="/admin/staff" className={styles.link}><Users size={14} />직원 등록·초대</OperationalLink></div>
            <label className={`${styles.field} ${styles.search}`}>사용자 검색<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="이름 또는 이메일" /></label>
            {currentUser && <UserEditor key={`${currentUser.id}:${currentUser.version}`} item={currentUser} snapshot={snapshot} isSuper={isSuper} onClose={() => transition(() => setSelectedUser(null))} onSaved={changed} />}
            <div className={styles.userList}>{users.map(item => <button key={item.id} type="button" className={styles.userRow} aria-expanded={item.id === selectedUser} onClick={() => transition(() => setSelectedUser(item.id === selectedUser ? null : item.id))}><span><strong>{item.displayName || '이름 미등록'}</strong><small>{item.email}</small></span><span>{roleLabels[item.role] || item.role}</span><span>{snapshot.organizations.find(org => org.id === item.organizationId)?.name || '소속 미설정'}<small>{item.role === 'super_admin' ? '플랫폼 전체' : item.role === 'admin' ? '사업자 내 모든 지점' : item.propertyIds.map(id => snapshot.properties.find(p => p.id === id)?.name || '숙소').join(' · ') || '지점 배정 없음'}</small></span><span className={styles.badge} data-status={item.status}>{statusLabels[item.status] || item.status}</span></button>)}</div>
            {!users.length && <div className={styles.empty}>표시할 사용자가 없습니다.</div>}
          </>}
          {tab === 'features' && <>
            <div className={styles.info}><ShieldCheck size={15} className="inline mr-2" />슈퍼매니저가 사업자에 제공할 기능을 정합니다. 사업자 관리자는 허용된 기능을 지점별로 끌 수 있습니다. 사용자 메뉴 권한은 그 범위 안에서 적용됩니다.</div>
            <div className={styles.featurePicker}>
              {isSuper && organizations.length > 0 && <div className={styles.actions} role="group" aria-label="기능 설정 범위"><button type="button" aria-pressed={featureScope === 'organization'} className={featureScope === 'organization' ? styles.primary : undefined} onClick={() => { if (featureScope !== 'organization') transition(() => setFeatureScope('organization')); }}>사업자 제공 기능</button><button type="button" aria-pressed={featureScope === 'property'} className={featureScope === 'property' ? styles.primary : undefined} onClick={() => { if (featureScope !== 'property') transition(() => setFeatureScope('property')); }}>지점별 기능</button></div>}
              {(!isSuper || featureScope === 'property' || !organizations.length) && <label className={styles.field}>설정할 지점<select value={featureProperty?.id || ''} onChange={event => { const next = event.target.value; transition(() => setFeaturePropertyId(next)); }}>{properties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small className={styles.muted}>사업자에서 꺼진 기능은 지점에서 켤 수 없습니다.</small></label>}
            </div>
            {isSuper && featureScope === 'organization' && organizations.length > 0 ? <FeatureEditor key={`org:${organizations[0].id}:${organizations[0].version}`} organization={organizations[0]} editable onSaved={changed} /> : featureProperty ? <FeatureEditor key={`property:${featureProperty.id}:${featureProperty.version}`} property={featureProperty} organization={snapshot.organizations.find(org => org.id === featureProperty.organizationId)} editable={isSuper || !!featureProperty.organizationId} onSaved={changed} /> : <div className={styles.empty}>설정할 지점이 없습니다. 지점 추가 요청부터 진행해 주세요.</div>}
          </>}
          {tab === 'requests' && <PropertyRequests organizations={snapshot.organizations} organizationId={organizationId} isSuper={isSuper} onChanged={changed} />}
        </section>
      </div>}
    </>}
  </div>;
}

function CreateOrganization({ onCreated, onClose }: { onCreated: (id: string) => Promise<void>; onClose: () => void }) {
  const operationsApi = useContext(OperationsApiContext);
  const [name, setName] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true); setError('');
    try { const result = await operationsApi<{ organization?: Organization; id?: string }>('/api/admin/organizations', json('POST', { name: name.trim() })); await onCreated(result.organization?.id || result.id || ''); }
    catch (cause) { setError(errorMessage(cause)); throw cause; } finally { setSaving(false); }
  };
  useDraftGuard({ label: '새 사업자 등록', dirty: !!name.trim(), save, discard: () => setName('') });
  return <form className={styles.card} onSubmit={event => { event.preventDefault(); void save().catch(() => {}); }}><h2>새 사업자</h2><div className={styles.editor}><label className={styles.field}>사업자 이름<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="예: 주식회사 운와들" /></label>{error && <div role="alert" className={styles.error}>{error}</div>}<div className={styles.actions}><button type="button" onClick={onClose} disabled={saving}>닫기</button><button type="submit" className={styles.primary} disabled={saving || !name.trim()}>{saving ? '추가 중…' : '사업자 추가'}</button></div></div></form>;
}

function OrganizationCard({ organization, organizations, allProperties, isSuper, onSaved }: { organization: Organization; organizations: Organization[]; allProperties: ManagedProperty[]; isSuper: boolean; onSaved: (message?: string) => Promise<void> }) {
  const operationsApi = useContext(OperationsApiContext);
  const preview = useContext(PreviewContext);
  const [open, setOpen] = useState(false); const [name, setName] = useState(organization.name); const [status, setStatus] = useState(organization.status);
  const [propertyIds, setPropertyIds] = useState(organization.propertyIds); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const [sourceOrganization, setSourceOrganization] = useState('__unassigned__');
  const [sourceProperties, setSourceProperties] = useState<ManagedProperty[]>([]); const [sourceLoading, setSourceLoading] = useState(false);
  const knownProperties = useRef(new Map<string, ManagedProperty>());
  const knownUsers = useRef(new Map<string, ManagedUser>());
  const [migrateAssignedUsers, setMigrateAssignedUsers] = useState(false); const sourceRun = useRef(0);
  const [email, setEmail] = useState(''); const [inviting, setInviting] = useState(false); const [invitationUrl, setInvitationUrl] = useState(''); const [copied, setCopied] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const dirty = name !== organization.name || status !== organization.status || JSON.stringify([...propertyIds].sort()) !== JSON.stringify([...organization.propertyIds].sort());
  const reset = () => { setName(organization.name); setStatus(organization.status); setPropertyIds(organization.propertyIds); setMigrateAssignedUsers(false); setError(''); };
  const save = async () => {
    setSaving(true); setError('');
    try { await operationsApi(`/api/admin/organizations/${organization.id}`, json('PATCH', { version: organization.version, name: name.trim(), status, propertyIds, migrateAssignedUsers })); await onSaved('사업자 정보와 지점 구성을 저장했습니다.'); }
    catch (cause) { setError(errorMessage(cause)); throw cause; } finally { setSaving(false); }
  };
  useDraftGuard({ label: `${organization.name} 사업자·지점 구성`, dirty, save, discard: reset });
  useDraftGuard({ label: `${organization.name} 관리자 초대 이메일`, dirty: !!email.trim() && !invitationUrl, discard: () => setEmail('') });
  useEffect(() => {
    if (!open || !isSuper) return;
    const run = ++sourceRun.current; setSourceLoading(true);
    void operationsApi<OperationsSnapshot>(`/api/admin/operations-settings?organizationId=${encodeURIComponent(sourceOrganization)}`).then(result => { if (run === sourceRun.current) { for (const property of result.properties) knownProperties.current.set(property.id, property); for (const user of result.users) knownUsers.current.set(user.id, user); setSourceProperties(result.properties); } }).catch(cause => { if (run === sourceRun.current) { setSourceProperties([]); setError(errorMessage(cause)); } }).finally(() => { if (run === sourceRun.current) setSourceLoading(false); });
    return () => { sourceRun.current += 1; };
  }, [open, isSuper, sourceOrganization, operationsApi]);
  const candidateProperties = [...new Map([...allProperties.filter(p => p.organizationId === organization.id), ...sourceProperties, ...[...knownProperties.current.values()].filter(p => propertyIds.includes(p.id))].map(p => [p.id, p])).values()];
  const incomingPropertyIds = new Set(candidateProperties.filter(property => property.organizationId !== organization.id && propertyIds.includes(property.id)).map(property => property.id));
  const unassignedAdmins = [...knownUsers.current.values()].filter(user => user.role === 'admin' && !user.organizationId && user.propertyIds.some(id => incomingPropertyIds.has(id)));
  return <article className={styles.card}><div className={styles.cardTop}><div><h2><Building2 size={16} className="inline mr-2" />{organization.name}</h2><p>{organization.propertyIds.length}개 지점 · {allProperties.filter(p => p.organizationId === organization.id).map(p => p.name).join(' · ') || '지점 미등록'}</p></div><span className={styles.badge} data-status={organization.status}>{statusLabels[organization.status] || organization.status}</span></div>
    {isSuper && <><div className={`${styles.actions} mt-4`}><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>사업자 관리</button></div>{open && <>
      <form className={styles.editor} onSubmit={event => { event.preventDefault(); void save().catch(() => {}); }}>
        <div className={styles.fields}><label className={styles.field}>사업자 이름<input required maxLength={120} disabled={saving} value={name} onChange={event => setName(event.target.value)} /></label><label className={styles.field}>사용 상태<select value={status} disabled={saving} onChange={event => setStatus(event.target.value)}><option value="active">사용 중</option><option value="inactive">사용 중지</option></select></label></div>
        <label className={styles.field}>추가할 지점의 현재 소속<select aria-label="추가할 지점의 현재 소속" value={sourceOrganization} disabled={saving || sourceLoading} onChange={event => setSourceOrganization(event.target.value)}><option value="__unassigned__">사업자 미배정 지점</option>{organizations.filter(item => item.id !== organization.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <fieldset disabled={saving || sourceLoading}><legend className={styles.muted}>소속 지점</legend>{sourceLoading && <p role="status">추가할 지점을 불러오는 중…</p>}<div className={styles.checkGrid}>{candidateProperties.map(p => <label key={p.id} className={styles.check}><input type="checkbox" checked={propertyIds.includes(p.id)} onChange={event => setPropertyIds(ids => event.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /><span>{p.name}{p.organizationId !== organization.id && <small>{organizations.find(item => item.id === p.organizationId)?.name || '사업자 미배정'} → {organization.name}</small>}</span></label>)}</div></fieldset>
        <label className={styles.check}><input type="checkbox" disabled={saving || sourceLoading} checked={migrateAssignedUsers} onChange={event => setMigrateAssignedUsers(event.target.checked)} /><span>기존 직원과 미배정 관리자도 이 사업자로 함께 연결<small>선택한 숙소에 배정된 사용자들의 소속을 함께 변경합니다. 각 사용자의 담당 지점을 모두 선택해야 합니다. 이미 다른 사업자에 소속된 관리자는 자동으로 이동하지 않습니다.</small></span></label>
        {unassignedAdmins.length > 0 && <div className={styles.info} aria-live="polite"><strong>함께 연결할 사업자 미배정 관리자</strong><ul className="my-2 list-disc pl-5">{unassignedAdmins.map(user => <li key={user.id}>{user.displayName || user.email}</li>)}</ul><p>위 ‘함께 연결’을 선택하고 저장하면 관리자 역할을 유지한 채 {organization.name}의 전체 숙소와 직원을 관리할 수 있게 됩니다.</p></div>}
        <p className={styles.muted}>지점을 소속에서 제외하면 해당 사업자 직원이 그 지점을 조회할 수 없게 됩니다.</p>
        {error && <div role="alert" className={styles.error}>{error}</div>}<SaveBar dirty={dirty} saving={saving} onReset={reset} />
      </form>
      <form className={styles.editor} onSubmit={async event => { event.preventDefault(); setInviting(true); setError(''); try { const result = await operationsApi<{ invitationUrl: string; invitation?: { expiresAt?: string } }>(`/api/admin/organizations/${organization.id}/invite`, json('POST', { email: email.trim() })); setInvitationUrl(new URL(result.invitationUrl, window.location.origin).href); setExpiresAt(result.invitation?.expiresAt || ''); setCopied(false); } catch (cause) { setError(errorMessage(cause)); } finally { setInviting(false); } }}><h3>사업자 관리자 초대</h3><p>초대 링크를 생성해 전달해 주세요. 이메일은 자동 발송되지 않습니다. 기존 계정도 본인 로그인 후 초대를 수락할 수 있습니다.</p><label className={styles.field}>초대할 이메일<input type="email" required maxLength={200} autoComplete="off" value={email} onChange={event => { setEmail(event.target.value); setInvitationUrl(''); setExpiresAt(''); }} placeholder="manager@example.com" /></label><div className={styles.actions}><button type="submit" disabled={inviting || !email.trim() || organization.status !== 'active'}>{inviting ? '생성 중…' : '초대 링크 만들기'}</button><OperationalLink href="/admin/staff">초대 현황·재발급·회수</OperationalLink></div></form>
      {invitationUrl && <div className={styles.invite}><strong>{preview ? '초대 링크 예시입니다.' : '초대 링크가 생성되었습니다.'}</strong><p>{preview ? '이 링크로 실제 계정을 만들 수 없습니다.' : `이 링크를 수락하면 ${organization.name}의 사업자 관리자가 됩니다.`}</p>{expiresAt && <p>유효기한: {localDate(expiresAt)}</p>}<input readOnly aria-label="사업자 관리자 초대 링크" value={invitationUrl} onFocus={event => event.target.select()} /><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(invitationUrl); setCopied(true); } catch { setCopied(false); setError('링크를 선택해 복사해 주세요.'); } }}><Clipboard size={14} />{copied ? '복사됨' : '링크 복사'}</button></div>}
    </>}</>}
  </article>;
}

function FeatureEditor({ organization, property, editable, onSaved }: { organization?: Organization; property?: ManagedProperty; editable: boolean; onSaved: (message?: string) => Promise<void> }) {
  const operationsApi = useContext(OperationsApiContext);
  const original = (property ? property.featureOverrides : organization?.features) || {};
  const [values, setValues] = useState<FeatureValues>(original); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const savedValues = property ? Object.fromEntries(Object.entries(values).filter(([key, enabled]) => !enabled || organization?.features[key as OperationalModule] !== false)) : values;
  const dirty = JSON.stringify(values) !== JSON.stringify(original);
  const reset = () => { setValues(original); setError(''); };
  const save = async () => { setSaving(true); setError(''); try { await operationsApi('/api/admin/operations-settings', json('PUT', property ? { properties: [{ id: property.id, version: property.version, featureOverrides: savedValues }] } : { organizations: [{ id: organization!.id, version: organization!.version, features: values }] })); await onSaved(`${property?.name || organization?.name}의 운영 기능을 저장했습니다.`); } catch (cause) { setError(errorMessage(cause)); throw cause; } finally { setSaving(false); } };
  useDraftGuard({ label: `${property?.name || organization?.name} 운영 기능`, dirty, save, discard: reset });
  return <form className={styles.card} onSubmit={event => { event.preventDefault(); void save().catch(() => {}); }}>
    <div className={styles.cardTop}><div><h2>{property?.name || organization?.name}</h2><p>{property ? `${organization?.name || '사업자 미배정'} · 지점별 설정` : '사업자에 제공되는 기능'}{!editable && ' · 슈퍼매니저가 관리합니다.'}</p></div><span className={styles.badge}>{property ? '지점' : '사업자'}</span></div>
    <div className={styles.featureGrid}>{OPERATIONAL_MODULES.map(module => {
      const denied = !!property && organization?.features[module.key] === false;
      const id = `feature-${property?.id || organization?.id}-${module.key}`;
      return <div key={module.key} className={styles.feature} data-disabled={denied || !editable}><label htmlFor={id}><strong>{module.key === 'priceLabs' ? 'PriceLabs 사용 허용' : module.label}</strong><small>{denied ? '사업자에서 제공하지 않는 기능' : module.key === 'priceLabs' ? '연동 옵션 사용 권한 · 실제 연결 상태와 별도' : module.description}</small></label>{property ? <select id={id} aria-label={`${module.label} 지점 설정`} disabled={!editable || denied || saving} value={denied ? 'inherit' : values[module.key] === undefined ? 'inherit' : values[module.key] ? 'on' : 'off'} onChange={event => setValues(current => { const next = { ...current }; if (event.target.value === 'inherit') delete next[module.key]; else next[module.key] = event.target.value === 'on'; return next; })}><option value="inherit">사업자 설정 따름{organization?.features[module.key] === false ? ' (꺼짐)' : ' (켜짐)'}</option><option value="on">사용</option><option value="off">사용 안 함</option></select> : <input id={id} type="checkbox" role="switch" checked={values[module.key] !== false} disabled={!editable || saving} onChange={event => setValues(current => ({ ...current, [module.key]: event.target.checked }))} />}</div>;
    })}</div>
    {error && <div role="alert" className={styles.error}>{error}</div>}{editable && <SaveBar sticky dirty={dirty} saving={saving} onReset={reset} />}
  </form>;
}

function UserEditor({ item, snapshot, isSuper, onClose, onSaved }: { item: ManagedUser; snapshot: OperationsSnapshot; isSuper: boolean; onClose: () => void; onSaved: (message?: string) => Promise<void> }) {
  const operationsApi = useContext(OperationsApiContext);
  const [role, setRole] = useState(item.role); const [status, setStatus] = useState(item.status); const [organizationId, setOrganizationId] = useState(item.organizationId || '');
  const [propertyIds, setPropertyIds] = useState(item.propertyIds); const [modules, setModules] = useState<OperationalModule[] | null>(item.enabledModules);
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [assignmentProperties, setAssignmentProperties] = useState(snapshot.properties); const [propertiesLoading, setPropertiesLoading] = useState(false); const propertiesRun = useRef(0);
  const self = snapshot.viewer.id === item.id; const editable = !self && (isSuper || ['manager', 'cleaner'].includes(item.role));
  const organization = snapshot.organizations.find(org => org.id === organizationId);
  const properties = assignmentProperties.filter(p => (p.organizationId || '') === organizationId);
  useEffect(() => {
    if (!isSuper || organizationId === (item.organizationId || '')) { setAssignmentProperties(snapshot.properties); setPropertiesLoading(false); return; }
    const run = ++propertiesRun.current; setPropertiesLoading(true); setAssignmentProperties([]);
    void operationsApi<OperationsSnapshot>(`/api/admin/operations-settings?organizationId=${encodeURIComponent(organizationId || '__unassigned__')}`).then(result => { if (run === propertiesRun.current) setAssignmentProperties(result.properties); }).catch(cause => { if (run === propertiesRun.current) setError(errorMessage(cause)); }).finally(() => { if (run === propertiesRun.current) setPropertiesLoading(false); });
    return () => { propertiesRun.current += 1; };
  }, [organizationId, isSuper, item.organizationId, snapshot.properties, operationsApi]);
  const allowed = normalizeModuleGrants(modules, role);
  const dirty = role !== item.role || status !== item.status || organizationId !== (item.organizationId || '') || JSON.stringify(propertyIds) !== JSON.stringify(item.propertyIds) || JSON.stringify(modules) !== JSON.stringify(item.enabledModules);
  const reset = () => { setRole(item.role); setStatus(item.status); setOrganizationId(item.organizationId || ''); setPropertyIds(item.propertyIds); setModules(item.enabledModules); setError(''); };
  const save = async () => { setSaving(true); setError(''); try { await operationsApi(`/api/admin/user-access/${item.id}`, json('PATCH', { version: item.version, role, ...(status !== item.status ? { status } : {}), ...(isSuper ? { organizationId: role === 'super_admin' ? null : organizationId || null } : {}), propertyIds, enabledModules: modules })); await onSaved('사용자 권한을 저장했습니다. 다음 요청부터 변경된 권한이 적용됩니다.'); } catch (cause) { setError(errorMessage(cause)); throw cause; } finally { setSaving(false); } };
  useDraftGuard({ label: `${item.displayName || item.email} 사용자 권한`, dirty, save, discard: reset });
  return <form className={styles.userDetail} onSubmit={event => { event.preventDefault(); void save().catch(() => {}); }}>
    <div className={styles.cardTop}><div><h2>{item.displayName || item.email}</h2><p>{item.email}</p></div><button type="button" onClick={onClose}>닫기</button></div>
    <div className={styles.editor}>
      {!editable && <div className={styles.info}>{self ? '본인 계정의 권한은 이 화면에서 변경할 수 없습니다.' : '사업자 관리자 권한은 슈퍼매니저가 관리합니다.'}</div>}
      <div className={styles.fields}><label className={styles.field}>역할<select disabled={!editable || saving} value={role} onChange={event => { const next = event.target.value; setRole(next); setModules(null); if (next === 'super_admin') { setOrganizationId(''); setPropertyIds([]); } }}><option value="manager">매니저</option><option value="cleaner">청소 담당자</option>{(isSuper || item.role === 'admin') && <option value="admin">사업자 관리자</option>}{(isSuper || item.role === 'super_admin') && <option value="super_admin">슈퍼매니저</option>}</select></label><label className={styles.field}>계정 상태<select value={status} disabled={!editable || saving || item.status === 'no_account'} onChange={event => setStatus(event.target.value)}><option value="active">사용 중</option><option value="suspended">사용 중지</option>{item.status === 'pending_invite' && <option value="pending_invite">가입 대기</option>}{item.status === 'no_account' && <option value="no_account">로그인 미발급</option>}</select>{item.status === 'no_account' && <small className={styles.muted}>직원 관리에서 비밀번호를 발급할 수 있습니다.</small>}</label>{isSuper && role !== 'super_admin' && <label className={styles.field}>소속 사업자<select value={organizationId} required={role === 'admin'} disabled={!editable || saving} onChange={event => { setOrganizationId(event.target.value); setPropertyIds([]); }}><option value="">사업자 미배정</option>{snapshot.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}</div>
      {['manager', 'cleaner'].includes(role) && <>
        <fieldset disabled={saving || propertiesLoading}><legend className={styles.muted}>담당 지점</legend>{propertiesLoading && <p role="status">지점을 불러오는 중…</p>}<div className={styles.checkGrid}>{properties.map(p => <label key={p.id} className={styles.check}><input type="checkbox" disabled={!editable} checked={propertyIds.includes(p.id)} onChange={event => setPropertyIds(ids => event.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /><span>{p.name}</span></label>)}</div>{!properties.length && !propertiesLoading && <p className={styles.muted}>소속 사업자의 지점이 없습니다.</p>}</fieldset>
        <fieldset disabled={saving}><legend className={styles.muted}>사용할 메뉴</legend><label className={styles.check}><input type="checkbox" disabled={!editable} checked={modules === null} onChange={event => setModules(event.target.checked ? null : allowed)} /><span>역할에 따른 기본 메뉴 사용<small>해제하면 아래에서 사용할 메뉴를 직접 고를 수 있습니다.</small></span></label><div className={`${styles.checkGrid} mt-3`}>{OPERATIONAL_MODULES.filter(module => role !== 'cleaner' || module.cleanerAllowed).map(module => <label key={module.key} className={styles.check}><input type="checkbox" checked={allowed.includes(module.key) && organization?.features[module.key] !== false} disabled={!editable || organization?.features[module.key] === false || modules === null} onChange={event => setModules(current => event.target.checked ? [...(current || []), module.key] : (current || []).filter(key => key !== module.key))} /><span>{module.label}<small>{organization?.features[module.key] === false ? '사업자에서 제공하지 않는 기능' : module.description}</small></span></label>)}</div></fieldset>
      </>}
      {role === 'admin' && <div className={styles.info}>사업자 관리자는 소속 사업자의 모든 지점과 사용자를 관리합니다. 제공 기능과 지점 추가 승인은 슈퍼매니저가 관리합니다.</div>}
      {role === 'super_admin' && <div className={styles.info}>슈퍼매니저는 전체 사업자와 사용자, 제공 기능을 관리합니다. 본인 계정의 권한은 이 화면에서 변경할 수 없습니다.</div>}
      {error && <div role="alert" className={styles.error}>{error}</div>}{editable && <SaveBar dirty={dirty} saving={saving || propertiesLoading} onReset={reset} />}
    </div>
  </form>;
}

function PropertyRequests({ organizations, organizationId, isSuper, onChanged }: { organizations: Organization[]; organizationId: string; isSuper: boolean; onChanged: (message?: string) => Promise<void> }) {
  const operationsApi = useContext(OperationsApiContext);
  const transition = useDraftTransition();
  const [items, setItems] = useState<PropertyRequest[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [name, setName] = useState(''); const [note, setNote] = useState(''); const [saving, setSaving] = useState(false);
  const [requestOrg, setRequestOrg] = useState(organizationId === '__unassigned__' ? '' : organizationId || organizations.find(item => item.status === 'active')?.id || '');
  const [statusFilter, setStatusFilter] = useState('requested'); const [hasMore, setHasMore] = useState(false); const [cursor, setCursor] = useState<string | null>(null); const latestRequest = useRef(0);
  const load = useCallback(async (nextCursor?: string) => {
    const run = ++latestRequest.current; setLoading(true); setError('');
    if (!nextCursor) { setItems([]); setCursor(null); setHasMore(false); }
    if (organizationId === '__unassigned__') { setLoading(false); return; }
    const params = new URLSearchParams({ pageSize: '50' });
    if (organizationId) params.set('organizationId', organizationId);
    if (statusFilter) params.set('status', statusFilter);
    if (nextCursor) params.set('cursor', nextCursor);
    try {
      const result = await operationsApi<{ items: PropertyRequest[]; hasMore: boolean; nextCursor: string | null }>(`/api/admin/property-requests?${params}`);
      if (run !== latestRequest.current) return;
      setItems(current => nextCursor ? [...current, ...result.items.filter(item => !current.some(old => old.id === item.id))] : result.items); setHasMore(result.hasMore); setCursor(result.nextCursor);
    } catch (cause) { if (run === latestRequest.current) setError(errorMessage(cause)); }
    finally { if (run === latestRequest.current) setLoading(false); }
  }, [operationsApi, organizationId, statusFilter]);
  useEffect(() => { void load(); return () => { latestRequest.current += 1; }; }, [load]);
  useEffect(() => { setRequestOrg(organizationId === '__unassigned__' ? '' : organizationId); }, [organizationId]);
  const saveRequest = async () => {
    setSaving(true); setError('');
    try { await operationsApi('/api/admin/property-requests', json('POST', { name: name.trim(), note: note.trim(), ...(isSuper ? { organizationId: requestOrg } : {}) })); setName(''); setNote(''); await load(); await onChanged('지점 추가 요청을 등록했습니다.'); }
    catch (cause) { setError(errorMessage(cause)); throw cause; } finally { setSaving(false); }
  };
  useDraftGuard({ label: '새 지점 추가 요청', dirty: !!name.trim() || !!note.trim(), save: name.trim() && requestOrg ? saveRequest : undefined, discard: () => { setName(''); setNote(''); } });
  if (organizationId === '__unassigned__') return <div className={styles.info}>지점 추가 요청을 확인하려면 상단에서 사업자를 선택해 주세요.</div>;
  return <>
    <div className={styles.sectionTitle}><div><h2>지점 추가 요청</h2><p>승인된 지점은 공개 준비 상태로 생성됩니다. 숙소 상세 정보와 사진을 등록한 뒤 공개해 주세요.</p></div></div>
    <form className={styles.card} onSubmit={event => { event.preventDefault(); void saveRequest().catch(() => {}); }}>
      <h2>추가할 지점</h2><div className={styles.editor}><div className={styles.fields}>{isSuper && <label className={styles.field}>사업자<select required value={requestOrg} onChange={event => setRequestOrg(event.target.value)}><option value="">사업자 선택</option>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}<label className={styles.field}>지점 이름<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="추가할 숙소 이름" /></label></div><label className={styles.field}>요청 내용 <span className={styles.muted}>(선택)</span><textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder="지점 위치 등 필요한 내용을 적어 주세요." /></label><div className={styles.actions}><button type="submit" className={styles.primary} disabled={saving || !name.trim() || !requestOrg}>{saving ? '요청 중…' : '추가 요청'}</button></div></div>
    </form>
    <div className={styles.sectionTitle}><label className={styles.field}>요청 상태<select aria-label="요청 상태" value={statusFilter} disabled={loading} onChange={event => { const next = event.target.value; transition(() => setStatusFilter(next)); }}><option value="requested">검토 대기</option><option value="approved">승인됨</option><option value="rejected">반려됨</option><option value="">모든 상태</option></select></label><button type="button" disabled={loading} onClick={() => transition(() => void load())}><RefreshCw size={14} />다시 불러오기</button></div>
    {error && <div role="alert" className={styles.error}>{error}</div>}{loading && !items.length ? <div role="status" className={styles.loading}>지점 요청을 불러오는 중…</div> : <div className={styles.stack}>{items.map(item => <RequestCard key={`${item.id}:${item.version}`} item={item} organizationName={organizations.find(org => org.id === item.organizationId)?.name || '사업자'} isSuper={isSuper} onSaved={async () => { await load(); await onChanged('지점 요청을 처리했습니다.'); }} />)}{!items.length && !error && <div className={styles.empty}>{statusFilter === 'requested' ? '검토 대기 중인 지점 요청이 없습니다.' : '선택한 상태의 지점 요청이 없습니다.'}</div>}</div>}
    {hasMore && <div className={styles.footer}><button type="button" disabled={loading || !cursor} onClick={() => { if (cursor) void load(cursor); }}>{loading ? '불러오는 중…' : '이전 요청 더 보기'}</button></div>}
  </>;
}

function RequestCard({ item, organizationName, isSuper, onSaved }: { item: PropertyRequest; organizationName: string; isSuper: boolean; onSaved: () => Promise<void> }) {
  const operationsApi = useContext(OperationsApiContext);
  const [note, setNote] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useDraftGuard({ label: `${item.name} 요청 처리 메모`, dirty: !!note.trim(), discard: () => setNote('') });
  const decide = async (status: 'approved' | 'rejected') => { setSaving(true); setError(''); try { await operationsApi(`/api/admin/property-requests/${item.id}`, json('PATCH', { version: item.version, status, decisionNote: note.trim() })); await onSaved(); } catch (cause) { setError(errorMessage(cause)); } finally { setSaving(false); } };
  return <article className={styles.card}><div className={styles.cardTop}><div><div className={styles.requestTitle}><h2>{item.name}</h2><span className={styles.badge} data-status={item.status}>{statusLabels[item.status] || item.status}</span></div><p>{organizationName} · {localDate(item.createdAt)}</p></div>{item.propertyId && <OperationalLink className={styles.link} href={`/admin/properties/${item.propertyId}/settings`}>숙소 설정</OperationalLink>}</div>{item.note && <p className="whitespace-pre-wrap">{item.note}</p>}{item.decisionNote && <p>처리 메모: {item.decisionNote}</p>}{isSuper && ['pending', 'requested'].includes(item.status) && <div className={styles.editor}><label className={styles.field}>처리 메모 <span className={styles.muted}>(선택)</span><textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder="승인 또는 반려 사유" /></label><div className={styles.actions}><button type="button" className={styles.primary} disabled={saving} onClick={() => void decide('approved')}>승인·지점 생성</button><button type="button" className={styles.danger} disabled={saving} onClick={() => void decide('rejected')}>반려</button></div></div>}{error && <div role="alert" className={styles.error}>{error}</div>}</article>;
}
