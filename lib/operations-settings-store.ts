import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizeRole } from '@/lib/access';
import type { SessionAuth } from '@/lib/auth';
import { fail } from '@/lib/core/errors';
import { auditData } from '@/lib/audit-log';
import { OPERATIONAL_MODULES, normalizeModuleGrants } from '@/lib/operational-permissions';

const moduleKeys = new Set<string>(OPERATIONAL_MODULES.map(item => item.key));
const moduleSchema = z.string().refine(value => moduleKeys.has(value), '알 수 없는 기능입니다.');
const featuresSchema = z.record(moduleSchema, z.boolean());
const idSchema = z.string().trim().min(1).max(100);
const idsSchema = z.array(idSchema).max(500).transform(value => [...new Set(value)]);
const versionSchema = z.number().int().positive();
const organizationCreateSchema = z.object({ name: z.string().trim().min(1).max(120), propertyIds: idsSchema.default([]), features: featuresSchema.default({}) }).strict();
const organizationUpdateSchema = z.object({ version: versionSchema, name: z.string().trim().min(1).max(120).optional(), status: z.enum(['active', 'inactive']).optional(), propertyIds: idsSchema.optional(), features: featuresSchema.optional(), migrateAssignedUsers: z.boolean().optional() }).strict().refine(value => Object.keys(value).some(key => !['version', 'migrateAssignedUsers'].includes(key)), '변경할 항목을 선택해 주세요.');
const settingsSchema = z.object({
  organizations: z.array(z.object({ id: idSchema, version: versionSchema, features: featuresSchema }).strict()).max(100).default([]),
  properties: z.array(z.object({ id: idSchema, version: versionSchema, organizationId: idSchema.nullable().optional(), featureOverrides: featuresSchema.optional() }).strict().refine(value => value.organizationId !== undefined || value.featureOverrides !== undefined, '변경할 지점 설정이 없습니다.')).max(500).default([]),
}).strict().refine(value => value.organizations.length + value.properties.length > 0, '변경할 설정이 없습니다.');
const userAccessSchema = z.object({ version: versionSchema, role: z.enum(['super_admin', 'admin', 'manager', 'cleaner']).optional(), status: z.enum(['active', 'suspended', 'pending_invite']).optional(), organizationId: idSchema.nullable().optional(), propertyIds: idsSchema.optional(), enabledModules: z.array(moduleSchema).max(OPERATIONAL_MODULES.length).nullable().optional() }).strict().refine(value => Object.keys(value).some(key => key !== 'version'), '변경할 권한이 없습니다.');
const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).strict();
const propertyRequestSchema = z.object({ organizationId: idSchema.optional(), name: z.string().trim().min(1).max(120), note: z.string().trim().max(2000).default('') }).strict();
const decideRequestSchema = z.object({ version: versionSchema, status: z.enum(['approved', 'rejected']), decisionNote: z.string().trim().max(2000).default('') }).strict();

type Transaction = Prisma.TransactionClient;
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw fail(400, result.error.issues[0]?.message || '설정값을 확인해 주세요.');
  return result.data;
}
function superOnly(auth: SessionAuth) { if (auth.role !== 'super_admin') throw fail(403, '슈퍼매니저만 변경할 수 있습니다.'); }
function businessScope(auth: SessionAuth): string | null {
  if (auth.role === 'super_admin') return null;
  if (auth.role !== 'admin' || !auth.user.organizationId) throw fail(403, '사업자 관리자 권한이 필요합니다.');
  return auth.user.organizationId;
}
function stale() { return fail(409, '다른 사용자가 설정을 변경했습니다. 새로고침 후 다시 저장해 주세요.'); }
function commandTransaction<T>(handler: (tx: Transaction) => Promise<T>): Promise<T> { return prisma.$transaction(handler, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
export async function settingsDatabase<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['P2021', 'P2022'].includes(String(error.code))) throw fail(503, '사업자·권한 설정을 사용하려면 데이터베이스 업데이트가 필요합니다.', { migrationRequired: true });
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') throw stale();
    throw error;
  }
}
async function existsOrganization(tx: Transaction, id: string) {
  const organization = await tx.organization.findUnique({ where: { id }, select: { id: true, status: true, features: true } });
  if (!organization) throw fail(400, '존재하지 않는 사업자입니다.');
  return organization;
}
async function validatePropertyIds(tx: Transaction, ids: string[], organizationId?: string | null) {
  if (!ids.length) return;
  const properties = await tx.property.findMany({ where: { id: { in: ids } }, select: { id: true, organizationId: true } });
  if (properties.length !== ids.length) throw fail(400, '존재하지 않는 지점이 포함되어 있습니다.');
  if (organizationId !== undefined && properties.some(property => property.organizationId !== organizationId)) throw fail(400, '사용자와 같은 사업자에 속한 지점만 배정할 수 있습니다.');
}
async function validateGrouping(tx: Transaction, propertyIds: string[], organizationId: string | null) {
  if (!propertyIds.length) return;
  await validatePropertyIds(tx, propertyIds);
  const assignments = await tx.userProperty.findMany({ where: { propertyId: { in: propertyIds } }, select: { user: { select: { role: true, organizationId: true } } } });
  if (assignments.some(assignment => normalizeRole(assignment.user.role) !== 'super_admin' && assignment.user.organizationId && assignment.user.organizationId !== organizationId)) throw fail(409, '이 지점에 다른 사업자의 직원이 배정되어 있습니다. 직원 배정을 정리한 뒤 이동해 주세요.');
}
async function explicitAudit(tx: Transaction, auth: SessionAuth, input: Parameters<typeof auditData>[1]) { await tx.auditLog.create({ data: auditData(auth, input) }); }
function organizationDto(row: { id: string; name: string; status: string; features: unknown; version: number }, propertyIds: string[]) { return { ...row, propertyIds }; }

export async function listOrganizations(auth: SessionAuth, req?: Request) {
  const scope = businessScope(auth);
  const picker = req && new URL(req.url).searchParams.get('picker') === '1';
  return settingsDatabase(async () => {
    const [organizations, properties] = await Promise.all([
      prisma.organization.findMany({ where: scope ? { id: scope } : {}, select: { id: true, name: true, status: true, features: true, version: true }, orderBy: { name: 'asc' }, take: 501 }),
      picker ? Promise.resolve([]) : prisma.property.findMany({ where: scope ? { organizationId: scope } : {}, select: { id: true, organizationId: true }, take: 2001 }),
    ]);
    if (organizations.length > 500 || properties.length > 2000) throw fail(400, '설정 목록이 너무 큽니다. 사업자 범위를 줄여 주세요.');
    return organizations.map(row => organizationDto(row, properties.filter(property => property.organizationId === row.id).map(property => property.id)));
  });
}

export async function getOperationsSettings(auth: SessionAuth, req?: Request) {
  const business = businessScope(auth);
  const requested = req ? new URL(req.url).searchParams.get('organizationId') : null;
  if (business && requested && requested !== business) throw fail(403, '다른 사업자의 설정에 접근할 수 없습니다.');
  const scope = business || requested;
  const selected = scope === '__unassigned__' ? null : scope;
  const scopeWhere = scope ? { organizationId: selected } : {};
  return settingsDatabase(async () => {
    const [organizations, properties, users] = await Promise.all([
      prisma.organization.findMany({ where: business ? { id: business } : {}, select: { id: true, name: true, status: true, features: true, version: true }, orderBy: { name: 'asc' }, take: 501 }),
      prisma.property.findMany({ where: scopeWhere, select: { id: true, name: true, organizationId: true, featureOverrides: true, featureVersion: true }, orderBy: { name: 'asc' }, take: 2001 }),
      prisma.user.findMany({ where: scopeWhere, select: { id: true, displayName: true, email: true, role: true, status: true, organizationId: true, enabledModules: true, accessVersion: true, properties: { select: { propertyId: true } } }, orderBy: { displayName: 'asc' }, take: 2001 }),
    ]);
    if (organizations.length > 500 || properties.length > 2000 || users.length > 2000) throw fail(400, '설정 목록이 너무 큽니다. 사업자 범위를 줄여 주세요.');
    return {
      viewer: { id: auth.session.userId, role: auth.role, organizationId: auth.user.organizationId ?? null },
      organizations: organizations.map(row => organizationDto(row, properties.filter(property => property.organizationId === row.id).map(property => property.id))),
      properties: properties.map(({ featureVersion, ...row }) => ({ ...row, version: featureVersion })),
      users: users.map(({ properties: assignments, accessVersion, ...row }) => ({ ...row, role: normalizeRole(row.role), version: accessVersion, propertyIds: assignments.map(item => item.propertyId) })),
      modules: OPERATIONAL_MODULES,
    };
  });
}

export async function createOrganization(auth: SessionAuth, body: unknown) {
  superOnly(auth); const input = parse(organizationCreateSchema, body);
  return settingsDatabase(() => commandTransaction(async tx => {
    // Existing assigned staff must first acquire the destination business identity.
    const id = randomUUID(); await validateGrouping(tx, input.propertyIds, id);
    const saved = await tx.organization.create({ data: { id, name: input.name, features: input.features, status: 'active', version: 1, createdBy: auth.session.userId } });
    if (input.propertyIds.length) await tx.property.updateMany({ where: { id: { in: input.propertyIds } }, data: { organizationId: id, featureVersion: { increment: 1 } } });
    await explicitAudit(tx, auth, { action: 'organization.create', module: 'properties', targetType: 'organization', targetId: id, organizationId: id, summary: `사업자 ${input.name} 등록`, details: { changedFields: ['name', 'features', 'propertyIds'] } });
    return organizationDto(saved, input.propertyIds);
  }));
}

export async function updateOrganization(auth: SessionAuth, id: string, body: unknown) {
  superOnly(auth); const input = parse(organizationUpdateSchema, body);
  return settingsDatabase(() => commandTransaction(async tx => {
    const current = await tx.organization.findUnique({ where: { id } });
    if (!current) throw fail(404, '사업자를 찾을 수 없습니다.');
    if (current.version !== input.version) throw stale();
    const currentProperties = await tx.property.findMany({ where: { organizationId: id }, select: { id: true } });
    const removed = input.propertyIds === undefined ? [] : currentProperties.filter(property => !input.propertyIds!.includes(property.id)).map(property => property.id);
    const incoming = input.propertyIds ? await tx.property.findMany({ where: { id: { in: input.propertyIds } }, select: { id: true, organizationId: true } }) : [];
    if (input.propertyIds && !input.migrateAssignedUsers) await validateGrouping(tx, input.propertyIds, id);
    if (input.propertyIds && input.migrateAssignedUsers) {
      await validatePropertyIds(tx, input.propertyIds);
      const movingIds = incoming.filter(property => property.organizationId !== id).map(property => property.id);
      const assignments = movingIds.length ? await tx.userProperty.findMany({ where: { propertyId: { in: movingIds } }, select: { userId: true } }) : [];
      const users = assignments.length ? await tx.user.findMany({ where: { id: { in: [...new Set(assignments.map(assignment => assignment.userId))] } }, include: { properties: { select: { propertyId: true } } } }) : [];
      for (const user of users) {
        const role = normalizeRole(user.role);
        if (role === 'super_admin' || user.organizationId === id) continue;
        // Initial business setup may include legacy administrators with no business.
        // An administrator already belonging to another business needs a separate transfer.
        if (role === 'admin' && user.organizationId !== null) throw fail(409, '다른 사업자에 소속된 관리자는 직원과 함께 이동할 수 없습니다. 사용자·권한에서 소속을 먼저 정리해 주세요.');
        if (user.properties.some(assignment => !input.propertyIds!.includes(assignment.propertyId))) throw fail(409, `${user.displayName || '직원'}에게 다른 지점 배정이 남아 있습니다. 담당 지점을 모두 옮기거나 배정을 먼저 정리해 주세요.`);
        await tx.user.update({ where: { id: user.id }, data: { organizationId: id, accessVersion: { increment: 1 }, publicToken: randomBytes(24).toString('base64url') } });
        await explicitAudit(tx, auth, { action: 'user.organization.move', module: 'staff', targetType: 'user', targetId: user.id, organizationId: id, summary: role === 'admin' ? '사업자 미배정 관리자 소속 연결·이전 일정 링크 회수' : '지점 이동과 함께 직원 소속 변경·이전 일정 링크 회수', details: { changedFields: ['organizationId'] } });
      }
    }
    await validateGrouping(tx, removed, null);
    const changed = await tx.organization.updateMany({ where: { id, version: input.version }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.status !== undefined ? { status: input.status } : {}), ...(input.features !== undefined ? { features: input.features } : {}), version: { increment: 1 } } });
    if (changed.count !== 1) throw stale();
    if (input.propertyIds !== undefined) {
      if (removed.length) await tx.property.updateMany({ where: { id: { in: removed } }, data: { organizationId: null, featureVersion: { increment: 1 } } });
      if (input.propertyIds.length) await tx.property.updateMany({ where: { id: { in: input.propertyIds } }, data: { organizationId: id, featureVersion: { increment: 1 } } });
      const previousOrganizations = [...new Set(incoming.map(property => property.organizationId).filter((source): source is string => !!source && source !== id))];
      if (previousOrganizations.length) await tx.organization.updateMany({ where: { id: { in: previousOrganizations } }, data: { version: { increment: 1 } } });
      for (const property of incoming.filter(property => property.organizationId && property.organizationId !== id)) await explicitAudit(tx, auth, { action: 'property.organization.move', module: 'properties', targetType: 'property', targetId: property.id, propertyId: property.id, organizationId: property.organizationId!, summary: '지점이 다른 사업자로 이동되었습니다.', details: { changedFields: ['organizationId'], destinationOrganizationId: id } });
    }
    const saved = await tx.organization.findUniqueOrThrow({ where: { id } });
    await explicitAudit(tx, auth, { action: 'organization.update', module: 'properties', targetType: 'organization', targetId: id, organizationId: id, summary: `사업자 ${saved.name} 설정 변경`, details: { changedFields: Object.keys(input).filter(key => key !== 'version') } });
    return organizationDto(saved, input.propertyIds ?? currentProperties.map(property => property.id));
  }));
}

export async function updateOperationsSettings(auth: SessionAuth, body: unknown) {
  const scope = businessScope(auth); const input = parse(settingsSchema, body);
  if (scope && (input.organizations.length || input.properties.some(property => property.organizationId !== undefined))) throw fail(403, '사업자 기능과 지점 소속은 슈퍼매니저만 설정할 수 있습니다.');
  if (new Set(input.organizations.map(item => item.id)).size !== input.organizations.length || new Set(input.properties.map(item => item.id)).size !== input.properties.length) throw fail(400, '같은 항목을 중복 저장할 수 없습니다.');
  await settingsDatabase(() => commandTransaction(async tx => {
    // Validate the whole command before applying any settings.
    for (const item of input.organizations) {
      const row = await tx.organization.findUnique({ where: { id: item.id }, select: { version: true } });
      if (!row) throw fail(404, '사업자를 찾을 수 없습니다.'); if (row.version !== item.version) throw stale();
    }
    for (const item of input.properties) {
      const row = await tx.property.findUnique({ where: { id: item.id }, select: { organizationId: true, featureVersion: true } });
      if (!row) throw fail(404, '지점을 찾을 수 없습니다.'); if (scope && row.organizationId !== scope) throw fail(403, '다른 사업자의 지점을 변경할 수 없습니다.'); if (row.featureVersion !== item.version) throw stale();
      if (item.organizationId) await existsOrganization(tx, item.organizationId);
      if (item.organizationId !== undefined && item.organizationId !== row.organizationId) await validateGrouping(tx, [item.id], item.organizationId);
      if (scope && item.featureOverrides) {
        const organization = await existsOrganization(tx, scope);
        const features = organization.features as Record<string, unknown>;
        if (Object.entries(item.featureOverrides).some(([key, value]) => value && features[key] === false)) throw fail(403, '사업자에서 사용할 수 없는 기능을 지점에서 켤 수 없습니다.');
      }
    }
    for (const item of input.organizations) {
      if ((await tx.organization.updateMany({ where: { id: item.id, version: item.version }, data: { features: item.features, version: { increment: 1 } } })).count !== 1) throw stale();
      await explicitAudit(tx, auth, { action: 'organization.features.update', module: 'properties', targetType: 'organization', targetId: item.id, organizationId: item.id, summary: '사업자 사용 기능 변경', details: { changedFields: ['features'] } });
    }
    for (const item of input.properties) {
      if ((await tx.property.updateMany({ where: { id: item.id, featureVersion: item.version }, data: { ...(item.organizationId !== undefined ? { organizationId: item.organizationId } : {}), ...(item.featureOverrides !== undefined ? { featureOverrides: item.featureOverrides } : {}), featureVersion: { increment: 1 } } })).count !== 1) throw stale();
      const property = await tx.property.findUniqueOrThrow({ where: { id: item.id }, select: { organizationId: true } });
      await explicitAudit(tx, auth, { action: 'property.features.update', module: 'properties', targetType: 'property', targetId: item.id, propertyId: item.id, organizationId: property.organizationId ?? undefined, summary: '지점 사용 기능과 소속 변경', details: { changedFields: Object.keys(item).filter(key => !['id', 'version'].includes(key)) } });
    }
  }));
  return getOperationsSettings(auth);
}

export async function updateUserAccess(auth: SessionAuth, id: string, body: unknown) {
  const scope = businessScope(auth); const input = parse(userAccessSchema, body);
  return settingsDatabase(() => commandTransaction(async tx => {
    const target = await tx.user.findUnique({ where: { id }, include: { properties: true } });
    if (!target) throw fail(scope ? 403 : 404, '사용자를 찾을 수 없습니다.');
    const currentRole = normalizeRole(target.role); const role = input.role ?? currentRole; const organizationId = input.organizationId === undefined ? target.organizationId : input.organizationId;
    if (scope && (target.organizationId !== scope || !['manager', 'cleaner'].includes(currentRole) || !['manager', 'cleaner'].includes(role) || input.organizationId !== undefined)) throw fail(403, '같은 사업자의 매니저와 청소 인력만 관리할 수 있습니다.');
    if (id === auth.session.userId && ((input.role !== undefined && role !== auth.role) || (input.status !== undefined && input.status !== 'active'))) throw fail(400, '본인의 관리자 권한이나 활성 상태를 해제할 수 없습니다.');
    if (target.status === 'no_account' && input.status === 'active') throw fail(400, '로그인 없는 직원은 직원 관리에서 먼저 비밀번호를 발급해 주세요.');
    if (role === 'admin' && !organizationId) throw fail(400, '사업자 관리자의 소속 사업자를 지정해 주세요.');
    if (role === 'super_admin' && organizationId) throw fail(400, '슈퍼매니저는 특정 사업자에 소속될 수 없습니다.');
    if (organizationId) await existsOrganization(tx, organizationId);
    if (target.accessVersion !== input.version) throw stale();
    if (input.enabledModules?.length && role === 'cleaner' && input.enabledModules.some(module => !OPERATIONAL_MODULES.find(item => item.key === module)?.cleanerAllowed)) throw fail(400, '청소 인력에게는 청소와 리포트 기능만 배정할 수 있습니다.');
    const propertyIds = ['super_admin', 'admin'].includes(role) ? [] : input.propertyIds ?? target.properties.map(item => item.propertyId);
    await validatePropertyIds(tx, propertyIds, organizationId ?? null);
    const enabledModules = input.enabledModules === undefined ? undefined : input.enabledModules === null ? Prisma.DbNull : normalizeModuleGrants(input.enabledModules, role);
    const rotateLink = organizationId !== target.organizationId || (input.status === 'suspended' && target.status !== 'suspended');
    const changed = await tx.user.updateMany({ where: { id, accessVersion: input.version }, data: { ...(input.role !== undefined ? { role } : {}), ...(input.status !== undefined ? { status: input.status } : {}), ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}), ...(enabledModules !== undefined ? { enabledModules } : {}), ...(rotateLink ? { publicToken: randomBytes(24).toString('base64url') } : {}), accessVersion: { increment: 1 } } });
    if (changed.count !== 1) throw stale();
    if (input.propertyIds !== undefined || ['super_admin', 'admin'].includes(role)) {
      await tx.userProperty.deleteMany({ where: { userId: id } });
      if (propertyIds.length) await tx.userProperty.createMany({ data: propertyIds.map(propertyId => ({ userId: id, propertyId })) });
    }
    await explicitAudit(tx, auth, { action: 'user.access.update', module: 'staff', targetType: 'user', targetId: id, organizationId: organizationId ?? undefined, summary: '사용자 역할·계정 상태·메뉴·지점 배정 변경', details: { changedFields: Object.keys(input).filter(key => key !== 'version') } });
    const saved = await tx.user.findUniqueOrThrow({ where: { id }, select: { id: true, displayName: true, email: true, role: true, status: true, organizationId: true, enabledModules: true, accessVersion: true } });
    return { ...saved, role: normalizeRole(saved.role), version: saved.accessVersion, propertyIds };
  }));
}

export async function inviteBusinessAdministrator(auth: SessionAuth, id: string, body: unknown, origin: string) {
  superOnly(auth); const input = parse(inviteSchema, body);
  return settingsDatabase(() => commandTransaction(async tx => {
    const organization = await existsOrganization(tx, id);
    if (organization.status !== 'active') throw fail(400, '활성 사업자에만 관리자를 초대할 수 있습니다.');
    const existing = await tx.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } }, include: { properties: true } });
    const pendingUnassigned = existing && existing.status === 'pending_invite' && !existing.organizationId && existing.properties.length === 0 && normalizeRole(existing.role) === 'manager';
    if (existing && !pendingUnassigned && (['super_admin', 'admin'].includes(normalizeRole(existing.role)) || existing.status !== 'active' || existing.organizationId !== id)) throw fail(409, '기존 관리자 또는 다른 사업자의 계정입니다. 사용자·권한에서 소속과 권한을 관리해 주세요.');
    const pending = await tx.invitation.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' }, status: 'pending', expiresAt: { gt: new Date() } }, select: { id: true } });
    if (pending) throw fail(409, '이미 진행 중인 초대가 있습니다. 사용자 관리에서 확인해 주세요.');
    const token = randomBytes(32).toString('base64url'); const expiresAt = new Date(Date.now() + 7 * 86400_000);
    const saved = await tx.invitation.create({ data: { email: input.email, role: 'admin', organizationId: id, propertyIds: [], invitedBy: auth.session.userId, token, status: 'pending', expiresAt } });
    await explicitAudit(tx, auth, { action: 'organization.admin.invite', module: 'staff', targetType: 'invitation', targetId: saved.id, organizationId: id, summary: '사업자 관리자 초대 링크 발급', details: { changedFields: ['role', 'organizationId'] } });
    return { invitation: { id: saved.id, email: saved.email, role: saved.role, organizationId: id, expiresAt }, invitationUrl: `${origin.replace(/\/$/, '')}/invite/${token}` };
  }));
}

export async function listPropertyRequests(auth: SessionAuth, req: Request) {
  const scope = businessScope(auth); const url = new URL(req.url); const organizationId = url.searchParams.get('organizationId');
  if (scope && organizationId && organizationId !== scope) throw fail(403, '다른 사업자의 요청에 접근할 수 없습니다.');
  const status = url.searchParams.get('status'); if (status && !['requested', 'approved', 'rejected'].includes(status)) throw fail(400, '요청 상태를 확인해 주세요.');
  const cursor = readCursor(url.searchParams.get('cursor'));
  const rows = await settingsDatabase(() => prisma.propertyRequest.findMany({ where: { ...(scope || organizationId ? { organizationId: scope || organizationId! } : {}), ...(status ? { status } : {}), ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 101 }));
  const items = rows.slice(0, 100); const last = items.at(-1);
  return { items, hasMore: rows.length > 100, nextCursor: rows.length > 100 && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null };
}
export async function createPropertyRequest(auth: SessionAuth, body: unknown) {
  const scope = businessScope(auth); const input = parse(propertyRequestSchema, body); const organizationId = scope || input.organizationId;
  if (!organizationId) throw fail(400, '사업자를 선택해 주세요.'); if (scope && input.organizationId && scope !== input.organizationId) throw fail(403, '다른 사업자에 지점을 요청할 수 없습니다.');
  return settingsDatabase(() => commandTransaction(async tx => {
    const organization = await existsOrganization(tx, organizationId); if (organization.status !== 'active') throw fail(403, '비활성 사업자의 지점은 추가할 수 없습니다.');
    const row = await tx.propertyRequest.create({ data: { organizationId, name: input.name, note: input.note, requestedBy: auth.session.userId, version: 1, status: 'requested' } });
    await explicitAudit(tx, auth, { action: 'property.request.create', module: 'properties', targetType: 'propertyRequest', targetId: row.id, organizationId, summary: `지점 ${input.name} 추가 요청`, details: { changedFields: ['name'] } }); return row;
  }));
}
export async function decidePropertyRequest(auth: SessionAuth, id: string, body: unknown) {
  superOnly(auth); const input = parse(decideRequestSchema, body);
  return settingsDatabase(() => commandTransaction(async tx => {
    const current = await tx.propertyRequest.findUnique({ where: { id } }); if (!current) throw fail(404, '지점 요청을 찾을 수 없습니다.'); if (current.version !== input.version || current.status !== 'requested') throw stale();
    const organization = await existsOrganization(tx, current.organizationId); if (input.status === 'approved' && organization.status !== 'active') throw fail(400, '비활성 사업자의 요청을 승인할 수 없습니다.');
    const decidedAt = new Date(); const propertyId = input.status === 'approved' ? randomUUID() : null;
    if ((await tx.propertyRequest.updateMany({ where: { id, version: input.version, status: 'requested' }, data: { status: input.status, decidedBy: auth.session.userId, decisionNote: input.decisionNote, propertyId, decidedAt, version: { increment: 1 } } })).count !== 1) throw stale();
    if (propertyId) {
      const requester = await tx.user.findUnique({ where: { id: current.requestedBy }, select: { id: true, organizationId: true, role: true } }); if (!requester || (normalizeRole(requester.role) !== 'super_admin' && requester.organizationId !== current.organizationId)) throw fail(409, '요청자의 소속이 변경되었습니다. 요청자를 확인해 주세요.');
      await tx.property.create({ data: { id: propertyId, name: current.name, ownerId: requester.id, organizationId: current.organizationId, timezone: 'Asia/Seoul', status: 'coming_soon', slug: `stay-${propertyId.slice(0, 8)}`, featureOverrides: {}, publicInfo: {}, featureVersion: 1 } });
    }
    await explicitAudit(tx, auth, { action: `property.request.${input.status}`, module: 'properties', targetType: 'propertyRequest', targetId: id, propertyId: propertyId ?? undefined, organizationId: current.organizationId, summary: `지점 ${current.name} 추가 요청 ${input.status === 'approved' ? '승인' : '반려'}`, details: { changedFields: ['status', 'propertyId'] } });
    return tx.propertyRequest.findUniqueOrThrow({ where: { id } });
  }));
}

function readCursor(raw: string | null) {
  if (!raw) return null;
  try { return parse(z.object({ createdAt: z.string().datetime(), id: idSchema }).strict(), JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))); } catch { throw fail(400, '조회 위치가 올바르지 않습니다.'); }
}
function dateFilter(raw: string | null, end: boolean) {
  if (!raw) return undefined;
  const input = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T${end ? '23:59:59.999' : '00:00:00.000'}+09:00` : raw;
  const date = new Date(input); if (!Number.isFinite(date.getTime())) throw fail(400, '조회 날짜가 올바르지 않습니다.'); return date;
}
export async function listActivity(auth: SessionAuth, req: Request) {
  const scope = businessScope(auth); const url = new URL(req.url); const organizationId = url.searchParams.get('organizationId'); const propertyId = url.searchParams.get('propertyId');
  if (scope && organizationId && organizationId !== scope) throw fail(403, '다른 사업자의 활동 기록에 접근할 수 없습니다.');
  const pageSize = Number(url.searchParams.get('pageSize') || 50); if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw fail(400, '조회 건수는 1~100건으로 지정해 주세요.');
  const operationalModule = url.searchParams.get('module'); if (operationalModule && !moduleKeys.has(operationalModule)) throw fail(400, '조회 기능을 확인해 주세요.');
  const outcome = url.searchParams.get('outcome'); if (outcome && !['success', 'denied', 'failed'].includes(outcome)) throw fail(400, '처리 결과를 확인해 주세요.');
  const from = dateFilter(url.searchParams.get('from'), false); const to = dateFilter(url.searchParams.get('to'), true); if (from && to && from > to) throw fail(400, '시작일이 종료일보다 늦습니다.');
  const cursor = readCursor(url.searchParams.get('cursor')); const actorId = url.searchParams.get('actorId'); const search = url.searchParams.get('search')?.trim();
  if (search && search.length > 100) throw fail(400, '검색어는 100자 이내로 입력해 주세요.');
  return settingsDatabase(async () => {
    if (scope && propertyId) { const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { organizationId: true } }); if (!property || property.organizationId !== scope) throw fail(403, '다른 사업자의 지점 기록에 접근할 수 없습니다.'); }
    const where: Prisma.AuditLogWhereInput = { ...(scope || organizationId ? { organizationId: scope || organizationId! } : {}), ...(propertyId ? { propertyId } : {}), ...(actorId ? { actorId } : {}), ...(operationalModule ? { module: operationalModule } : {}), ...(outcome ? { outcome } : {}), ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}), ...(search ? { summary: { contains: search, mode: 'insensitive' } } : {}), ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {}) };
    const rows = await prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: pageSize + 1, select: { id: true, actorId: true, actorName: true, action: true, module: true, targetType: true, targetId: true, propertyId: true, organizationId: true, summary: true, outcome: true, requestId: true, createdAt: true, details: true } });
    const items = rows.slice(0, pageSize); const last = items.at(-1); const hasMore = rows.length > pageSize;
    return { items, hasMore, nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null };
  });
}
