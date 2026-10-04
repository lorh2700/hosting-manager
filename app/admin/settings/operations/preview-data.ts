import { OPERATIONAL_MODULES, isOperationalModule, normalizeModuleGrants, type OperationalModule } from '@/lib/operational-permissions';
import type { OperationsSnapshot, Organization, PropertyRequest, FeatureValues, operationsApi } from './types';

/** This store never calls a server, sends an invitation or writes operational data. */
interface PreviewInvitation { id: string; email: string; role: string; organizationId: string; token: string; status: string; expiresAt: string }
export interface PreviewStore { snapshot: OperationsSnapshot; requests: PropertyRequest[]; invitations: PreviewInvitation[]; sequence: number }
export function createPreviewStore(): PreviewStore {
  return {
    snapshot: {
      viewer: { id: 'preview-super', role: 'super_admin', organizationId: null },
      organizations: [
        { id: 'preview-company-a', name: '주식회사 운와들 · 예시', status: 'active', features: { priceLabs: false }, version: 1, propertyIds: ['preview-anon', 'preview-unwadang'] },
        { id: 'preview-company-b', name: '다른 사업자 · 예시', status: 'active', features: { laundry: false, priceLabs: false }, version: 1, propertyIds: ['preview-property-b'] },
      ],
      properties: [
        { id: 'preview-anon', name: '안온재 · 예시', organizationId: 'preview-company-a', featureOverrides: {}, version: 1 },
        { id: 'preview-unwadang', name: '운와당 · 예시', organizationId: 'preview-company-a', featureOverrides: { tours: false }, version: 1 },
        { id: 'preview-property-b', name: '다른 사업자의 숙소 · 예시', organizationId: 'preview-company-b', featureOverrides: {}, version: 1 },
        { id: 'preview-legacy-property', name: '사업자 미배정 숙소 · 예시', organizationId: null, featureOverrides: {}, version: 1 },
      ],
      users: [
        { id: 'preview-super', displayName: '플랫폼 운영자 · 예시', email: 'platform@example.invalid', role: 'super_admin', status: 'active', organizationId: null, propertyIds: [], enabledModules: null, version: 1 },
        { id: 'preview-admin-a', displayName: '사업자 담당자 · 예시', email: 'owner@example.invalid', role: 'admin', status: 'active', organizationId: 'preview-company-a', propertyIds: [], enabledModules: null, version: 1 },
        { id: 'preview-manager-a', displayName: '지점 매니저 · 예시', email: 'manager@example.invalid', role: 'manager', status: 'active', organizationId: 'preview-company-a', propertyIds: ['preview-anon', 'preview-unwadang'], enabledModules: ['reservations', 'cleaning', 'inventory', 'laundry', 'issues', 'supplies', 'staff', 'properties'], version: 1 },
        { id: 'preview-cleaner-a', displayName: '청소 담당자 · 예시', email: 'cleaner@example.invalid', role: 'cleaner', status: 'active', organizationId: 'preview-company-a', propertyIds: ['preview-anon'], enabledModules: null, version: 1 },
        { id: 'preview-admin-b', displayName: '다른 사업자 담당자 · 예시', email: 'other@example.invalid', role: 'admin', status: 'active', organizationId: 'preview-company-b', propertyIds: [], enabledModules: null, version: 1 },
        { id: 'preview-super-other', displayName: '추가 슈퍼매니저 · 예시', email: 'super-other@example.invalid', role: 'super_admin', status: 'active', organizationId: null, propertyIds: [], enabledModules: null, version: 1 },
        { id: 'preview-legacy-cleaner', displayName: '미배정 사업자 직원 · 예시', email: 'legacy@example.invalid', role: 'cleaner', status: 'active', organizationId: null, propertyIds: ['preview-legacy-property'], enabledModules: null, version: 1 },
        { id: 'preview-legacy-admin', displayName: '미배정 기존 관리자 · 예시', email: 'legacy-admin@example.invalid', role: 'admin', status: 'active', organizationId: null, propertyIds: ['preview-legacy-property'], enabledModules: null, version: 1 },
      ],
    },
    requests: [{ id: 'preview-request', name: '신규 한옥 지점 · 예시', note: '서울 신규 지점의 운영을 준비하고 있습니다.', status: 'requested', organizationId: 'preview-company-a', version: 1, createdAt: '2026-10-04T00:00:00+09:00' }],
    invitations: [], sequence: 0,
  };
}

export function createPreviewOperationsApi(store: PreviewStore, role: string): typeof operationsApi {
  const copy = <T,>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
  const stale = () => new Error('다른 사용자가 먼저 수정했습니다. 다시 불러온 뒤 변경 내용을 확인해 주세요.');
  const versionsMatch = (item: { version: number }, version: unknown) => { if (!Number.isInteger(version) || item.version !== version) throw stale(); };
  const featureValues = (value: unknown): FeatureValues => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, enabled]) => !isOperationalModule(key) || typeof enabled !== 'boolean')) throw new Error('운영 기능 값을 확인해 주세요.');
    return value as FeatureValues;
  };
  const propertyIds = (value: unknown): string[] => { if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id)) throw new Error('지점 선택을 확인해 주세요.'); return [...new Set(value)] as string[]; };
  return async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const target = new URL(url, 'http://preview.invalid'); const path = target.pathname; const method = init?.method || 'GET';
    const body = (typeof init?.body === 'string' ? JSON.parse(init.body) : {}) as Record<string, unknown>;
    const isSuper = role === 'super_admin'; const organizationId = 'preview-company-a'; const actorId = isSuper ? 'preview-super' : `preview-${role}-a`;
    if (!isSuper && role !== 'admin') throw new Error('사업자 관리자와 슈퍼매니저만 설정을 관리할 수 있습니다.');
    const snapshot = copy<OperationsSnapshot>(store.snapshot); const requests = copy<PropertyRequest[]>(store.requests); const invitations = copy<PreviewInvitation[]>(store.invitations);
    const done = (result: unknown): T => { store.snapshot = snapshot; store.requests = requests; store.invitations = invitations; return copy<T>(result); };
    const superOnly = () => { if (!isSuper) throw new Error('슈퍼매니저만 처리할 수 있습니다.'); };
    const findOrganization = (id: unknown) => { const item = snapshot.organizations.find(org => org.id === id); if (!item || !isSuper && item.id !== organizationId) throw new Error('사업자를 찾을 수 없거나 접근 권한이 없습니다.'); return item; };
    const requestedScope = target.searchParams.get('organizationId');
    if (!isSuper && requestedScope && requestedScope !== organizationId) throw new Error('다른 사업자의 설정에 접근할 수 없습니다.');
    const selectedScope = isSuper ? requestedScope : organizationId;
    const scoped = (id: string | null) => !selectedScope || (selectedScope === '__unassigned__' ? id === null : id === selectedScope);
    const nextId = (prefix: string) => `${prefix}-${++store.sequence}`;
    if (method === 'GET' && path === '/api/admin/organizations') return copy<T>({ organizations: snapshot.organizations.filter(item => isSuper || item.id === organizationId).map(item => target.searchParams.get('picker') ? { ...item, propertyIds: [] } : item) });
    if (method === 'GET' && path === '/api/admin/operations-settings') return copy<T>({
      viewer: { id: actorId, role, organizationId: isSuper ? null : organizationId },
      organizations: snapshot.organizations.filter(item => isSuper || item.id === organizationId),
      properties: snapshot.properties.filter(item => scoped(item.organizationId)), users: snapshot.users.filter(item => scoped(item.organizationId)), modules: OPERATIONAL_MODULES,
    });
    if (method === 'GET' && path === '/api/admin/property-requests') {
      const status = target.searchParams.get('status'); if (status && !['requested', 'approved', 'rejected'].includes(status)) throw new Error('요청 상태를 확인해 주세요.');
      let items = requests.filter(item => scoped(item.organizationId) && (!status || item.status === status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const cursor = target.searchParams.get('cursor'); if (cursor) { const index = items.findIndex(item => item.id === cursor); if (index < 0) throw new Error('이전 요청 위치를 확인해 주세요.'); items = items.slice(index + 1); }
      const size = Math.min(100, Math.max(1, Number(target.searchParams.get('pageSize')) || 50)); const page = items.slice(0, size); const hasMore = items.length > size;
      return copy<T>({ items: page, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null });
    }
    if (method === 'POST' && path === '/api/admin/organizations') {
      superOnly(); if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) throw new Error('사업자 이름을 확인해 주세요.');
      const organization: Organization = { id: nextId('preview-added'), name: body.name.trim(), status: 'active', features: body.features === undefined ? {} : featureValues(body.features), version: 1, propertyIds: [] };
      snapshot.organizations.push(organization); return done({ organization });
    }
    if (method === 'PATCH' && /^\/api\/admin\/organizations\/[^/]+$/.test(path)) {
      superOnly(); const organization = findOrganization(path.split('/').pop()); versionsMatch(organization, body.version);
      const selected = body.propertyIds === undefined ? organization.propertyIds : propertyIds(body.propertyIds);
      if (selected.some(id => !snapshot.properties.some(p => p.id === id))) throw new Error('지점을 찾을 수 없습니다.');
      const removing = organization.propertyIds.filter(id => !selected.includes(id));
      if (snapshot.users.some(user => user.organizationId === organization.id && user.propertyIds.some(id => removing.includes(id)))) throw new Error('제외할 지점에 배정된 직원이 있습니다. 새 사업자에서 지점을 추가하며 직원 소속도 함께 이동해 주세요.');
      const incoming = selected.filter(id => !organization.propertyIds.includes(id)); const movers = snapshot.users.filter(user => user.role !== 'super_admin' && user.propertyIds.some(id => incoming.includes(id)) && user.organizationId !== organization.id);
      if (movers.some(user => user.role === 'admin' && user.organizationId !== null)) throw new Error('다른 사업자의 관리자 소속은 사용자 권한에서 먼저 확인해 주세요.');
      if (movers.length && body.migrateAssignedUsers !== true) throw new Error('기존 직원의 소속도 함께 이동하도록 선택해 주세요.');
      if (movers.some(user => !user.propertyIds.every(id => selected.includes(id)))) throw new Error('직원이 다른 사업자의 지점에도 배정되어 있습니다. 모든 담당 지점을 함께 선택해 주세요.');
      if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120)) throw new Error('사업자 이름을 확인해 주세요.');
      if (body.status !== undefined && !['active', 'inactive'].includes(String(body.status))) throw new Error('사업자 상태를 확인해 주세요.');
      for (const user of movers) { user.organizationId = organization.id; user.version += 1; }
      for (const property of snapshot.properties) {
        if (selected.includes(property.id) && property.organizationId !== organization.id) { property.organizationId = organization.id; property.version += 1; }
        else if (property.organizationId === organization.id && !selected.includes(property.id)) { property.organizationId = null; property.version += 1; }
      }
      for (const other of snapshot.organizations) if (other.id !== organization.id) { const remaining = other.propertyIds.filter(id => !incoming.includes(id)); if (remaining.length !== other.propertyIds.length) { other.propertyIds = remaining; other.version += 1; } }
      Object.assign(organization, { ...(body.name === undefined ? {} : { name: String(body.name).trim() }), ...(body.status === undefined ? {} : { status: body.status }), propertyIds: selected, version: organization.version + 1 }); return done({ organization });
    }
    if (method === 'POST' && /^\/api\/admin\/organizations\/[^/]+\/invite$/.test(path)) {
      superOnly(); const organization = findOrganization(path.split('/').at(-2)); if (organization.status !== 'active') throw new Error('활성 사업자에만 관리자를 초대할 수 있습니다.');
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''; if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('이메일을 확인해 주세요.');
      const existing = snapshot.users.find(user => user.email.toLowerCase() === email);
      if (existing && !(existing.status === 'pending_invite' && !existing.organizationId && existing.role === 'manager' && !existing.propertyIds.length || existing.status === 'active' && existing.organizationId === organization.id && ['manager', 'cleaner'].includes(existing.role))) throw new Error('기존 계정의 소속과 관리자 권한을 확인해 주세요.');
      if (invitations.some(invite => invite.email === email && invite.status === 'pending' && new Date(invite.expiresAt) > new Date())) throw new Error('이미 진행 중인 초대가 있습니다. 직원 관리의 초대 현황에서 확인해 주세요.');
      const invitation: PreviewInvitation = { id: nextId('preview-invite'), token: nextId('preview-token'), email, role: 'admin', organizationId: organization.id, status: 'pending', expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() };
      invitations.push(invitation); return done({ invitation, invitationUrl: `/admin/settings/preview#sample-invitation-${invitation.id}` });
    }
    if (method === 'PUT' && path === '/api/admin/operations-settings') {
      const organizations = (body.organizations || []) as { id: string; version: number; features: FeatureValues }[];
      const properties = (body.properties || []) as { id: string; version: number; featureOverrides: FeatureValues; organizationId?: string | null }[];
      if (!Array.isArray(organizations) || !Array.isArray(properties) || !organizations.length && !properties.length) throw new Error('변경할 설정을 확인해 주세요.');
      for (const update of organizations) { superOnly(); const item = findOrganization(update.id); versionsMatch(item, update.version); item.features = featureValues(update.features); item.version += 1; }
      for (const update of properties) {
        const item = snapshot.properties.find(property => property.id === update.id); if (!item || !isSuper && item.organizationId !== organizationId) throw new Error('다른 사업자의 지점을 변경할 수 없습니다.'); versionsMatch(item, update.version);
        if (update.organizationId !== undefined) throw new Error('지점 소속은 사업자 관리에서 변경해 주세요.');
        const values = featureValues(update.featureOverrides); const organization = snapshot.organizations.find(org => org.id === item.organizationId);
        if (Object.entries(values).some(([key, enabled]) => enabled && organization?.features[key as OperationalModule] === false)) throw new Error('사업자에서 제공하지 않는 기능은 지점에서 켤 수 없습니다.'); item.featureOverrides = values; item.version += 1;
      }
      return done({ success: true });
    }
    if (method === 'PATCH' && path.startsWith('/api/admin/user-access/')) {
      const user = snapshot.users.find(item => item.id === path.split('/').pop()); if (!user) throw new Error('사용자를 찾을 수 없습니다.'); versionsMatch(user, body.version);
      const nextRole = body.role === undefined ? user.role : String(body.role); const nextOrganization = body.organizationId === undefined ? user.organizationId : body.organizationId as string | null;
      if (!['super_admin', 'admin', 'manager', 'cleaner'].includes(nextRole)) throw new Error('사용자 역할을 확인해 주세요.');
      if (!isSuper && (user.organizationId !== organizationId || !['manager', 'cleaner'].includes(user.role) || !['manager', 'cleaner'].includes(nextRole) || body.organizationId !== undefined)) throw new Error('같은 사업자의 매니저와 청소 인력만 관리할 수 있습니다.');
      if (user.id === actorId && (nextRole !== role || body.status !== undefined && body.status !== 'active')) throw new Error('본인의 관리자 권한이나 활성 상태를 해제할 수 없습니다.');
      if (user.status === 'no_account' && body.status === 'active') throw new Error('직원 관리에서 먼저 비밀번호를 발급해 주세요.');
      if (nextRole === 'admin' && !nextOrganization || nextRole === 'super_admin' && nextOrganization) throw new Error('역할에 맞는 소속 사업자를 확인해 주세요.');
      if (nextOrganization) findOrganization(nextOrganization);
      if (body.status !== undefined && !['active', 'suspended', 'pending_invite', 'no_account'].includes(String(body.status))) throw new Error('계정 상태를 확인해 주세요.');
      const selected = ['super_admin', 'admin'].includes(nextRole) ? [] : body.propertyIds === undefined ? user.propertyIds : propertyIds(body.propertyIds);
      if (selected.some(id => !snapshot.properties.some(property => property.id === id && property.organizationId === (nextOrganization || null)))) throw new Error('같은 사업자의 지점만 배정할 수 있습니다.');
      if (body.enabledModules !== undefined && body.enabledModules !== null && (!Array.isArray(body.enabledModules) || body.enabledModules.some(value => !isOperationalModule(value) || nextRole === 'cleaner' && !OPERATIONAL_MODULES.find(module => module.key === value)?.cleanerAllowed))) throw new Error('역할에 맞는 메뉴를 선택해 주세요.');
      Object.assign(user, { role: nextRole, organizationId: nextOrganization || null, propertyIds: selected, ...(body.status === undefined ? {} : { status: body.status }), ...(body.enabledModules === undefined ? {} : { enabledModules: body.enabledModules === null ? null : normalizeModuleGrants(body.enabledModules, nextRole) }), version: user.version + 1 }); return done({ user });
    }
    if (method === 'POST' && path === '/api/admin/property-requests') {
      const organization = findOrganization(isSuper ? body.organizationId : organizationId); if (organization.status !== 'active') throw new Error('비활성 사업자의 지점은 추가할 수 없습니다.');
      if (!isSuper && body.organizationId && body.organizationId !== organizationId) throw new Error('다른 사업자에 지점을 요청할 수 없습니다.');
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) throw new Error('지점 이름을 확인해 주세요.');
      const request: PropertyRequest = { id: nextId('preview-request'), name: body.name.trim(), note: String(body.note || '').slice(0, 2000), organizationId: organization.id, status: 'requested', version: 1, createdAt: new Date().toISOString() }; requests.unshift(request); return done({ request });
    }
    if (method === 'PATCH' && path.startsWith('/api/admin/property-requests/')) {
      superOnly(); const request = requests.find(item => item.id === path.split('/').pop()); if (!request) throw new Error('지점 요청을 찾을 수 없습니다.'); versionsMatch(request, body.version); if (request.status !== 'requested') throw stale();
      if (!['approved', 'rejected'].includes(String(body.status))) throw new Error('요청 처리 상태를 확인해 주세요.'); const organization = findOrganization(request.organizationId); if (body.status === 'approved' && organization.status !== 'active') throw new Error('비활성 사업자의 요청을 승인할 수 없습니다.');
      Object.assign(request, body, { version: request.version + 1 });
      if (body.status === 'approved') {
        const id = nextId('preview-new-property');
        snapshot.properties.push({ id, name: request.name, organizationId: request.organizationId, featureOverrides: {}, version: 1 });
        organization.propertyIds.push(id); organization.version += 1; request.propertyId = id;
      }
      return done({ request });
    }
    throw new Error('시안에서 지원하지 않는 동작입니다. 실제 데이터는 변경되지 않았습니다.');
  };
}
