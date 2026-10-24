import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { fail } from '../../../lib/core/errors';
import { normalizePhone, phoneToSyntheticEmail, isSyntheticEmail } from '../../../lib/phone';
import { assertOperationalAccess } from '../../../lib/operational-access';
import { parseJongnoEventInput, parseJongnoEventQuery, JongnoValidationError, type JongnoEventInput } from '../../../lib/jongno-events';
import { createCleanerSchema, updateCleanerSchema, staffLoginSchema, staffInviteSchema, staffScheduleSchema, jongnoEventSchema, updateJongnoEventSchema, archiveJongnoEventSchema } from '../../contracts/people-events';
import { createPeopleEventsRepository, eventDto, staffSelect, type StaffRow, type PeopleEventsDatabase } from '../../data/people-events-repository';
import type { BackendIdentity } from '../identity/access';
import { normalizeRole } from '../identity/roles';
import { propertyScopeWhere, moduleAllowed, readIdentityRevision } from '../reads/policy';
import { auditData } from '../operations/audit';
import type { OperationsTransactionRunner } from '../operations/types';

export type PeopleEventsActor = BackendIdentity & { requestId?: string };
export interface StaffQuery { organizationId?: string; cursor?: string; limit?: number }
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw fail(400, result.error.issues[0]?.message || '입력 내용을 확인해 주세요.');
  return result.data;
}
export function assertStaffManagement(actor: PeopleEventsActor) {
  assertOperationalAccess(actor, 'staff');
  if (!['super_admin', 'admin', 'manager'].includes(actor.role) || actor.user.status !== 'active') throw fail(403, '직원 관리 권한이 없습니다.');
  if (actor.role !== 'super_admin' && !actor.organizationId) throw fail(403, '소속 사업자를 확인해 주세요.');
}
export function assertJongnoManagement(actor: PeopleEventsActor) {
  if (actor.role !== 'super_admin' || actor.user.status !== 'active') throw fail(403, '슈퍼매니저만 종로 행사를 관리할 수 있습니다.');
}
function stale() { return fail(409, '다른 사용자가 변경했습니다. 최신 정보를 불러온 뒤 다시 저장해 주세요.'); }
function phoneValue(value: string) { const phone = normalizePhone(value); if (!phone) throw fail(400, '연락처를 확인해 주세요.'); return phone; }
function eventInput(body: unknown): JongnoEventInput {
  try { return parseJongnoEventInput(body); } catch (error) { if (error instanceof JongnoValidationError) throw fail(400, error.message); throw error; }
}
function eventData(input: JongnoEventInput) {
  return { ...input, images: input.images as unknown as Prisma.InputJsonValue,
    excludedWeekdays: input.excludedWeekdays as Prisma.InputJsonValue, excludedDates: input.excludedDates as Prisma.InputJsonValue,
    verifiedAt: input.verifiedAt ? new Date(input.verifiedAt) : null };
}

export function createPeopleEventsService(dependencies: { database: PeopleEventsDatabase; transaction: OperationsTransactionRunner; now?: () => Date; legacyOrigin?: string }) {
  const database = dependencies.database;
  const now = dependencies.now ?? (() => new Date());
  const repository = createPeopleEventsRepository(database);
  const legacyOrigin = dependencies.legacyOrigin || process.env.NEXT_PUBLIC_SITE_URL || 'https://voidanchae.com';

  async function propertyOptions(actor: PeopleEventsActor, organizationId?: string | null, db = database) {
    const where: Prisma.PropertyWhereInput = { AND: [propertyScopeWhere(actor), ...(organizationId !== undefined ? [{ organizationId }] : [])] };
    const properties = await createPeopleEventsRepository(db).properties(where);
    if (properties.length > 200) throw fail(400, '사업자 범위를 좁혀 주세요. 한 번에 200개 숙소까지 관리할 수 있습니다.');
    return properties.filter(property => moduleAllowed(actor, 'staff', property));
  }
  function canManage(actor: PeopleEventsActor, user: StaffRow, allowedIds: string[]) {
    const role = normalizeRole(user.role);
    if (!['manager', 'cleaner'].includes(role) || user.properties.length > 200) return false;
    if (actor.role === 'super_admin') return true;
    if (user.organizationId !== actor.organizationId) return false;
    return actor.role === 'admin' || (role === 'cleaner' && (user.properties.length > 0
      ? user.properties.every(item => allowedIds.includes(item.propertyId)) : user.ownerId === actor.user.id));
  }
  function staffDto(actor: PeopleEventsActor, user: StaffRow, allowedIds: string[]) {
    const manageable = canManage(actor, user, allowedIds);
    return { id: user.id, name: user.displayName || (isSyntheticEmail(user.email) ? '청소 담당자' : user.email),
      email: isSyntheticEmail(user.email) ? '' : user.email, phone: user.phone || '', role: normalizeRole(user.role), status: user.status,
      organization: user.organization, version: user.accessVersion, ownerId: user.ownerId, loginEnabled: !!user.password,
      properties: user.properties.filter(item => actor.role !== 'manager' || allowedIds.includes(item.propertyId)).slice(0, 200).map(item => ({ id: item.property.id, name: item.property.name })),
      propertiesHasMore: user.properties.length > 200, canManage: manageable,
      canRetire: manageable,
      scheduleUrl: manageable && user.publicToken && user.status !== 'suspended' ? new URL(`/c/${user.publicToken}`, legacyOrigin).href : null,
    };
  }
  async function organizationScope(actor: PeopleEventsActor, requested?: string | null, db = database) {
    const organizationId = actor.role === 'super_admin' ? requested ?? null : actor.organizationId;
    if (actor.role !== 'super_admin' && requested !== undefined && requested !== organizationId) throw fail(404, '사업자를 찾을 수 없습니다.');
    if (organizationId && !await db.organization.findFirst({ where: { id: organizationId, status: 'active' }, select: { id: true } })) throw fail(400, '사용 중인 사업자를 선택해 주세요.');
    return organizationId;
  }
  async function mutableStaff(actor: PeopleEventsActor, target: string, db = database) {
    assertStaffManagement(actor);
    const user = await createPeopleEventsRepository(db).staffById(target);
    const options = await propertyOptions(actor, user?.organizationId, db);
    if (!user || !canManage(actor, user, options.map(item => item.id))) throw fail(404, '관리할 청소 인력을 찾을 수 없습니다.');
    return { user, options };
  }

  return {
    async authorizeCommand(actor: PeopleEventsActor, routeId: string, targetId: string, body: unknown) {
      if (['updateCleaner', 'configureStaffLogin', 'inviteStaff', 'rotateStaffSchedule'].includes(routeId)) { await mutableStaff(actor, targetId); return; }
      if (routeId === 'createCleaner') {
        assertStaffManagement(actor);
        const input = parse(createCleanerSchema, body);
        if (input.role === 'manager' && actor.role === 'manager') throw fail(403, '매니저 계정은 사업자 관리자만 등록할 수 있습니다.');
        const organizationId = await organizationScope(actor, input.organizationId);
        const options = await propertyOptions(actor, organizationId);
        if (input.propertyIds.some(id => !options.some(property => property.id === id))) throw fail(404, '배정할 수 없는 숙소가 포함되어 있습니다.');
        return;
      }
      assertJongnoManagement(actor);
    },
    async listStaff(actor: PeopleEventsActor, query: StaffQuery = {}) {
      assertStaffManagement(actor);
      const limit = query.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail(400, '조회 개수는 1~100 사이여야 합니다.');
      if (query.organizationId !== undefined && (query.organizationId.length > 100 || !query.organizationId)) throw fail(400, '사업자 범위를 확인해 주세요.');
      if (actor.role !== 'super_admin' && query.organizationId && query.organizationId !== actor.organizationId) throw fail(404, '사업자를 찾을 수 없습니다.');
      const options = await propertyOptions(actor, query.organizationId);
      const allowedIds = options.map(property => property.id);
      const scope = createHash('sha256').update(`${readIdentityRevision(actor)}:${query.organizationId ?? ''}`).digest('hex');
      let after: string | undefined;
      if (query.cursor) {
        try {
          if (query.cursor.length > 2048 || !/^[\w-]+$/.test(query.cursor)) throw new Error();
          const cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
          if (cursor.scope !== scope || typeof cursor.id !== 'string' || cursor.id.length > 100 || cursor.expiresAt <= now().getTime()) throw new Error();
          after = cursor.id;
        } catch { throw fail(400, '직원 목록을 처음부터 다시 조회해 주세요.'); }
      }
      const where: Prisma.UserWhereInput = actor.role === 'super_admin' ? (query.organizationId ? { organizationId: query.organizationId } : {})
        : actor.role === 'admin' ? { organizationId: actor.organizationId, role: { not: 'super_admin' } }
          : { organizationId: actor.organizationId, OR: [{ id: actor.user.id }, { role: 'cleaner', ownerId: actor.user.id }, { role: 'cleaner', properties: { some: { propertyId: { in: allowedIds } } } }] };
      const rows = await repository.staff({ AND: [where, ...(after ? [{ id: { gt: after } }] : [])] }, limit + 1);
      const visible = rows.slice(0, limit);
      const hasMore = rows.length > limit;
      return { staff: visible.map(user => staffDto(actor, user, allowedIds)), properties: options.map(property => ({ id: property.id, name: property.name, organizationId: property.organizationId })),
        staffPage: { hasMore, nextCursor: hasMore ? Buffer.from(JSON.stringify({ id: visible.at(-1)!.id, scope, expiresAt: now().getTime() + 1800000 })).toString('base64url') : null },
        scopeVersion: readIdentityRevision(actor), snapshotAt: now().toISOString() };
    },
    async getStaff(actor: PeopleEventsActor, id: string) {
      const { user, options } = await mutableStaff(actor, id);
      return { staff: staffDto(actor, user, options.map(property => property.id)), properties: options.map(property => ({ id: property.id, name: property.name, organizationId: property.organizationId })) };
    },
    async createCleaner(actor: PeopleEventsActor, body: unknown) {
      assertStaffManagement(actor);
      const input = parse(createCleanerSchema, body);
      if (input.role === 'manager' && actor.role === 'manager') throw fail(403, '매니저 계정은 사업자 관리자만 등록할 수 있습니다.');
      const phone = phoneValue(input.phone);
      const initialPassword = input.loginEnabled ? randomBytes(12).toString('base64url') : null;
      const password = initialPassword ? await bcrypt.hash(initialPassword, 12) : '';
      try {
        return await dependencies.transaction(async tx => {
          const organizationId = await organizationScope(actor, input.organizationId, tx);
          const options = await propertyOptions(actor, organizationId, tx);
          if (input.propertyIds.some(id => !options.some(property => property.id === id))) throw fail(404, '배정할 수 없는 숙소가 포함되어 있습니다.');
          const email = phoneToSyntheticEmail(phone)!;
          if (await tx.user.findFirst({ where: { OR: [{ email }, { phone }] }, select: { id: true } })) throw fail(409, '같은 연락처의 계정이 있습니다. 기존 직원을 확인해 주세요.');
          const user = await tx.user.create({ data: { displayName: input.name, email, phone, password, role: input.role,
            status: input.loginEnabled ? 'active' : 'no_account', organizationId, ownerId: actor.user.id, publicToken: randomBytes(24).toString('base64url'), notifyNewOpen: false } });
          if (input.propertyIds.length) await tx.userProperty.createMany({ data: input.propertyIds.map(propertyId => ({ userId: user.id, propertyId })) });
          await tx.auditLog.create({ data: auditData(actor, { action: 'staff.create', module: 'staff', targetType: 'user', targetId: user.id,
            organizationId, summary: `${input.name} ${input.role === 'manager' ? '매니저' : '청소 인력'} 등록`, details: { changedFields: ['displayName', 'phone', 'properties', 'status'] } }) });
          const saved = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: staffSelect });
          return { staff: staffDto(actor, saved, options.map(property => property.id)), initialPassword, loginIdentifier: initialPassword ? phone : null };
        });
      } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw fail(409, '같은 연락처의 계정이 있습니다.'); throw error; }
    },
    async updateCleaner(actor: PeopleEventsActor, id: string, body: unknown) {
      assertStaffManagement(actor);
      const input = parse(updateCleanerSchema, body);
      return dependencies.transaction(async tx => {
        const { user, options } = await mutableStaff(actor, id, tx);
        const allowedIds = options.map(property => property.id);
        if (user.accessVersion !== input.version) throw stale();
        if (input.propertyIds?.some(propertyId => !allowedIds.includes(propertyId))) throw fail(404, '배정할 수 없는 숙소가 포함되어 있습니다.');
        if (user.status === 'suspended' && input.status !== 'active' && input.propertyIds?.length) throw fail(400, '퇴사한 직원을 복원한 뒤 숙소를 배정해 주세요.');
        const phone = input.phone === undefined ? user.phone : phoneValue(input.phone);
        const email = input.phone !== undefined && isSyntheticEmail(user.email) ? phoneToSyntheticEmail(phone!)! : user.email;
        if (input.phone !== undefined && await tx.user.findFirst({ where: { id: { not: user.id }, OR: [{ phone }, { email }] }, select: { id: true } })) throw fail(409, '같은 연락처의 계정이 있습니다.');
        const status = input.status === 'active' ? (user.password ? 'active' : 'no_account') : input.status;
        const changed = await tx.user.updateMany({ where: { id, accessVersion: input.version }, data: {
          ...(input.name !== undefined ? { displayName: input.name } : {}), ...(input.phone !== undefined ? { phone, email } : {}),
          ...(status ? { status } : {}), ...(input.status === 'suspended' ? { publicToken: null, notifyNewOpen: false } : {}),
          ...(input.status === 'suspended' && actor.role === 'manager' ? { ownerId: actor.user.id } : {}),
          ...(input.status === 'active' && !user.publicToken ? { publicToken: randomBytes(24).toString('base64url') } : {}), accessVersion: { increment: 1 },
        } });
        if (changed.count !== 1) throw stale();
        if (input.status === 'suspended') {
          await tx.userProperty.deleteMany({ where: { userId: id } });
          await tx.invitation.updateMany({ where: { cleanerId: id, status: 'pending' }, data: { status: 'expired' } });
        }
        else if (input.propertyIds !== undefined) {
          await tx.userProperty.deleteMany({ where: { userId: id, ...(actor.role === 'manager' ? { propertyId: { in: allowedIds } } : {}) } });
          if (input.propertyIds.length) await tx.userProperty.createMany({ data: input.propertyIds.map(propertyId => ({ userId: id, propertyId })), skipDuplicates: true });
        }
        await tx.auditLog.create({ data: auditData(actor, { action: input.status === 'suspended' ? 'staff.retire' : input.status === 'active' ? 'staff.restore' : 'staff.update',
          module: 'staff', targetType: 'user', targetId: id, organizationId: user.organizationId,
          summary: `${input.name || user.displayName || '청소 인력'} ${input.status === 'suspended' ? '퇴사 처리' : input.status === 'active' ? '복원' : '정보 변경'}`,
          details: { changedFields: Object.keys(input).filter(key => key !== 'version') } }) });
        const saved = await tx.user.findUniqueOrThrow({ where: { id }, select: staffSelect });
        return { staff: staffDto(actor, saved, allowedIds) };
      });
    },
    async configureStaffLogin(actor: PeopleEventsActor, id: string, body: unknown) {
      assertStaffManagement(actor);
      const input = parse(staffLoginSchema, body);
      const initialPassword = input.enabled ? randomBytes(12).toString('base64url') : null;
      const password = initialPassword ? await bcrypt.hash(initialPassword, 12) : '';
      return dependencies.transaction(async tx => {
        const { user, options } = await mutableStaff(actor, id, tx);
        if (user.status === 'suspended') throw fail(400, '퇴사한 직원을 먼저 복원해 주세요.');
        const changed = await tx.user.updateMany({ where: { id, accessVersion: input.version }, data: { password, status: input.enabled ? 'active' : 'no_account', accessVersion: { increment: 1 } } });
        if (changed.count !== 1) throw stale();
        await tx.auditLog.create({ data: auditData(actor, { action: 'staff.login.configure', module: 'staff', targetType: 'user', targetId: id,
          organizationId: user.organizationId, summary: `${user.displayName || '청소 담당자'} 로그인 ${input.enabled ? '설정' : '중지'}` }) });
        const saved = await tx.user.findUniqueOrThrow({ where: { id }, select: staffSelect });
        return { staff: staffDto(actor, saved, options.map(property => property.id)), initialPassword, loginIdentifier: isSyntheticEmail(user.email) ? user.phone : user.email };
      });
    },
    async inviteStaff(actor: PeopleEventsActor, id: string, body: unknown) {
      assertStaffManagement(actor);
      const input = parse(staffInviteSchema, body);
      const email = input.email.trim().toLowerCase();
      return dependencies.transaction(async tx => {
        const { user } = await mutableStaff(actor, id, tx);
        if (user.accessVersion !== input.version) throw stale();
        if (user.status !== 'no_account') throw fail(409, '로그인 미사용 직원만 가입 초대를 받을 수 있습니다.');
        if (await tx.user.findUnique({ where: { email }, select: { id: true } })) throw fail(409, '이미 가입한 이메일입니다.');
        if (await tx.invitation.findFirst({ where: { OR: [{ email }, { cleanerId: id }], status: 'pending', expiresAt: { gt: now() } }, select: { id: true } })) throw fail(409, '사용 중인 초대가 있습니다. 기존 초대를 확인해 주세요.');
        await tx.invitation.updateMany({ where: { OR: [{ email }, { cleanerId: id }], status: 'pending', expiresAt: { lte: now() } }, data: { status: 'expired' } });
        const invitation = await tx.invitation.create({ data: { email, role: user.role, organizationId: user.organizationId, propertyIds: [], invitedBy: actor.user.id,
          cleanerId: id, status: 'pending', token: randomBytes(24).toString('base64url'), expiresAt: new Date(now().getTime() + 7 * 86400000) } });
        await tx.auditLog.create({ data: auditData(actor, { action: 'staff.invite', module: 'staff', targetType: 'user', targetId: id, organizationId: user.organizationId, summary: `${user.displayName || '청소 담당자'} 가입 초대 링크 발급` }) });
        return { invitationUrl: new URL(`/invite/${invitation.token}`, legacyOrigin).href, expiresAt: invitation.expiresAt.toISOString() };
      });
    },
    async rotateStaffSchedule(actor: PeopleEventsActor, id: string, body: unknown) {
      assertStaffManagement(actor);
      const input = parse(staffScheduleSchema, body);
      return dependencies.transaction(async tx => {
        const { user, options } = await mutableStaff(actor, id, tx);
        if (user.status === 'suspended') throw fail(400, '퇴사한 직원을 먼저 복원해 주세요.');
        const token = randomBytes(24).toString('base64url');
        const changed = await tx.user.updateMany({ where: { id, accessVersion: input.version }, data: { publicToken: token, accessVersion: { increment: 1 } } });
        if (changed.count !== 1) throw stale();
        await tx.auditLog.create({ data: auditData(actor, { action: 'staff.schedule.rotate', module: 'staff', targetType: 'user', targetId: id, organizationId: user.organizationId, summary: `${user.displayName || '청소 담당자'} 개인 일정 링크 재발급` }) });
        const saved = await tx.user.findUniqueOrThrow({ where: { id }, select: staffSelect });
        return { staff: staffDto(actor, saved, options.map(property => property.id)), scheduleUrl: new URL(`/c/${token}`, legacyOrigin).href };
      });
    },
    async listJongnoEvents(actor: PeopleEventsActor, params: URLSearchParams) {
      assertJongnoManagement(actor);
      let query;
      try { query = parseJongnoEventQuery(params, false, now()); } catch (error) { if (error instanceof JongnoValidationError) throw fail(400, error.message); throw error; }
      const where: Prisma.JongnoEventWhereInput = { ...(query.status ? { status: query.status } : {}), ...(query.category ? { category: query.category } : {}),
        ...(query.area ? { area: query.area } : {}), ...(query.range ? { startDate: { lte: query.range.to }, endDate: { gte: query.range.from } } : {}) };
      const rows = await database.jongnoEvent.findMany({ where, orderBy: [{ startDate: 'asc' }, { id: 'asc' }], take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
      const visible = rows.slice(0, query.limit);
      return { events: visible.map(eventDto), hasMore: rows.length > query.limit, nextCursor: rows.length > query.limit ? visible.at(-1)!.id : null, range: query.range };
    },
    async getJongnoEvent(actor: PeopleEventsActor, id: string) {
      assertJongnoManagement(actor);
      const event = await database.jongnoEvent.findUnique({ where: { id } });
      if (!event) throw fail(404, '행사를 찾을 수 없습니다.');
      return { event: eventDto(event) };
    },
    async createJongnoEvent(actor: PeopleEventsActor, body: unknown) {
      assertJongnoManagement(actor);
      const input = eventInput(parse(jongnoEventSchema, body));
      return dependencies.transaction(async tx => {
        const row = await tx.jongnoEvent.create({ data: { ...eventData(input), createdBy: actor.user.id } });
        await tx.auditLog.create({ data: auditData(actor, { action: 'jongno-event.create', module: null, targetType: 'jongno-event', targetId: row.id, summary: `${row.titleKo} 행사 등록` }) });
        return { event: eventDto(row) };
      });
    },
    async updateJongnoEvent(actor: PeopleEventsActor, id: string, body: unknown) {
      assertJongnoManagement(actor);
      const { version, ...bodyInput } = parse(updateJongnoEventSchema, body);
      const input = eventInput(bodyInput);
      return dependencies.transaction(async tx => {
        const changed = await tx.jongnoEvent.updateMany({ where: { id, version }, data: { ...eventData(input), version: { increment: 1 } } });
        if (changed.count !== 1) throw stale();
        const row = await tx.jongnoEvent.findUniqueOrThrow({ where: { id } });
        await tx.auditLog.create({ data: auditData(actor, { action: 'jongno-event.update', module: null, targetType: 'jongno-event', targetId: id, summary: `${row.titleKo} 행사 수정`, details: { changedFields: ['content', 'images', 'status'] } }) });
        return { event: eventDto(row) };
      });
    },
    async archiveJongnoEvent(actor: PeopleEventsActor, id: string, body: unknown) {
      assertJongnoManagement(actor);
      const { version } = parse(archiveJongnoEventSchema, body);
      return dependencies.transaction(async tx => {
        const changed = await tx.jongnoEvent.updateMany({ where: { id, version }, data: { status: 'cancelled', version: { increment: 1 } } });
        if (changed.count !== 1) throw stale();
        const row = await tx.jongnoEvent.findUniqueOrThrow({ where: { id } });
        await tx.auditLog.create({ data: auditData(actor, { action: 'jongno-event.archive', module: null, targetType: 'jongno-event', targetId: id, summary: `${row.titleKo} 행사 비공개 보관` }) });
        return { event: eventDto(row) };
      });
    },
  };
}
export type PeopleEventsService = ReturnType<typeof createPeopleEventsService>;
