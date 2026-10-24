import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { calendarGridRange } from '../../../lib/calendar-month';
import { todayKst } from '../../../lib/dates';
import { assertOperationalAccess } from '../../../lib/operational-access';
import type { OperationalModule } from '../../../lib/operational-permissions';
import { PrismaBackendReadRepository, type BackendReadSnapshot } from '../../data/read-repository';
import type { BackendIdentity } from '../identity/access';
import { normalizeRole } from '../identity/roles';
import { attachCleaning, projectCleaning, projectStays, type BookingReadRow, type CleaningReadRow, type EventReadRow } from './projections';
import {
  assertRowLimit, MAX_READ_PROPERTIES, MAX_READ_ROWS, moduleAllowed, operationalModules,
  propertyScopeWhere, readCapabilities, readError, readIdentityRevision, requestedPropertyIds,
} from './policy';

export interface PropertyPageQuery { cursor?: string; limit?: number }
export interface StaffPageQuery extends PropertyPageQuery { organizationId?: string }
export interface CalendarReadQuery { month?: string; propertyIds?: string[]; cleaner?: boolean }
export interface TodayReadQuery { date?: string; propertyIds?: string[] }
type PropertyRow = Awaited<ReturnType<BackendReadSnapshot['properties']>>[number];
interface PageCursor { version: 1; name: string; id: string; scope: string; expiresAt: number }
const CURSOR_TTL_MS = 30 * 60 * 1_000;

function dateInput(value: string | undefined, now: Date): string {
  if (value === undefined) return todayKst(now);
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw readError(400, 'INVALID_DATE', '조회 날짜는 유효한 YYYY-MM-DD 형식이어야 합니다.');
  }
  return value;
}

function cursorInput(value: string | undefined, scope: string, now: Date): PageCursor | null {
  if (value === undefined) return null;
  try {
    if (!value || value.length > 2_048 || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as PageCursor;
    if (cursor.version !== 1 || typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 200 ||
      typeof cursor.name !== 'string' || cursor.name.length > 500 || cursor.scope !== scope ||
      !Number.isFinite(cursor.expiresAt) || cursor.expiresAt <= now.getTime() || cursor.expiresAt > now.getTime() + CURSOR_TTL_MS) throw new Error();
    return cursor;
  } catch { throw readError(400, 'INVALID_CURSOR', '숙소 목록을 처음부터 다시 불러와 주세요.'); }
}

function propertySummary(identity: BackendIdentity, property: PropertyRow) {
  return { id: property.id, name: property.name, timezone: property.timezone, status: property.status,
    organization: property.organization ? { id: property.organization.id, name: property.organization.name } : null,
    capabilities: readCapabilities(identity, property), operationalModules: operationalModules(identity, property) };
}

function scopedWhere(identity: BackendIdentity, propertyIds?: string[]): Prisma.PropertyWhereInput {
  const scope = propertyScopeWhere(identity);
  return propertyIds === undefined ? scope : { AND: [scope, { id: { in: propertyIds } }] };
}

async function readProperties(snapshot: BackendReadSnapshot, identity: BackendIdentity, ids: string[] | undefined, module: OperationalModule) {
  assertOperationalAccess(identity, module);
  const properties = await snapshot.properties(scopedWhere(identity, ids), MAX_READ_PROPERTIES + 1);
  if (properties.length > MAX_READ_PROPERTIES) throw readError(400, 'RANGE_TOO_LARGE', `숙소를 ${MAX_READ_PROPERTIES}개 이하로 선택해 주세요.`);
  const allowed = properties.filter(property => moduleAllowed(identity, module, property));
  if (ids && (allowed.length !== ids.length || ids.some(id => !allowed.some(property => property.id === id)))) {
    throw readError(404, 'NOT_FOUND', '조회할 숙소를 찾을 수 없습니다.');
  }
  return allowed;
}

export class BackendReadService {
  private readonly repository: PrismaBackendReadRepository;
  private readonly now: () => Date;
  private readonly accessRevision: (identity: BackendIdentity) => Promise<string>;

  constructor(db: Pick<PrismaClient, '$transaction'>, options: { now?: () => Date; accessRevision?: (identity: BackendIdentity) => Promise<string> } = {}) {
    this.repository = new PrismaBackendReadRepository(db);
    this.now = options.now ?? (() => new Date());
    this.accessRevision = options.accessRevision ?? (async identity => readIdentityRevision(identity));
  }

  async properties(identity: BackendIdentity, query: PropertyPageQuery = {}) {
    const now = this.now();
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw readError(400, 'INVALID_LIMIT', '조회 개수는 1~100 사이여야 합니다.');
    const scopeVersion = await this.accessRevision(identity);
    const cursor = cursorInput(query.cursor, scopeVersion, now);
    return this.repository.snapshot(async snapshot => {
      const where: Prisma.PropertyWhereInput = { AND: [propertyScopeWhere(identity), ...(cursor ? [{ OR: [
        { name: { gt: cursor.name } }, { name: cursor.name, id: { gt: cursor.id } },
      ] }] : [])] };
      const rows = await snapshot.properties(where, limit + 1);
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ version: 1, name: last.name,
        id: last.id, scope: scopeVersion, expiresAt: now.getTime() + CURSOR_TTL_MS } satisfies PageCursor)).toString('base64url') : null;
      return { properties: items.map(property => propertySummary(identity, property)),
        propertiesPage: { hasMore, nextCursor }, scopeVersion, snapshotAt: now.toISOString() };
    });
  }

  async bootstrap(identity: BackendIdentity, query: PropertyPageQuery = {}) {
    const page = await this.properties(identity, query);
    const organization = identity.user.organization;
    const propertyFeatures = ['reservations.', 'guests.', 'inventory.', 'laundry.', 'supplies.', 'settlement.'];
    const capabilities = readCapabilities(identity).filter(capability => identity.role === 'super_admin' || page.propertiesPage.hasMore ||
      !propertyFeatures.some(prefix => capability.startsWith(prefix)) || page.properties.some(property => property.capabilities.includes(capability)));
    return { user: { id: identity.user.id, name: identity.user.displayName || identity.user.email, role: identity.role },
      organization: organization ? { id: organization.id, name: organization.name } : null,
      capabilities, operationalModules: operationalModules(identity),
      ...page, timezone: 'Asia/Seoul' };
  }

  async staff(identity: BackendIdentity, query: StaffPageQuery = {}) {
    const now = this.now();
    assertOperationalAccess(identity, 'staff');
    let propertyWhere = propertyScopeWhere(identity);
    if (!['super_admin', 'admin'].includes(identity.role)) {
      const allowed = identity.user.properties.filter(item => item.property.organizationId === identity.organizationId && moduleAllowed(identity, 'staff', item.property)).map(item => item.propertyId);
      propertyWhere = { AND: [propertyWhere, { id: { in: allowed } }] };
    }
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw readError(400, 'INVALID_LIMIT', '조회 개수는 1~100 사이여야 합니다.');
    if (query.organizationId !== undefined && (!query.organizationId || query.organizationId.length > 200)) throw readError(400, 'INVALID_ORGANIZATION', '사업자를 확인해 주세요.');
    if (identity.role !== 'super_admin' && query.organizationId !== undefined && query.organizationId !== identity.organizationId) throw readError(404, 'NOT_FOUND', '조회할 사업자를 찾을 수 없습니다.');
    const scopeVersion = await this.accessRevision(identity);
    const cursorScope = `${scopeVersion}:staff:${query.organizationId ?? ''}`;
    const cursor = cursorInput(query.cursor, cursorScope, now);
    let where: Prisma.UserWhereInput;
    if (identity.role === 'super_admin') where = query.organizationId ? { organizationId: query.organizationId } : {};
    else if (identity.role === 'admin') where = identity.organizationId
      ? { organizationId: identity.organizationId, NOT: { role: 'super_admin' } } : { id: { in: [] } };
    else where = { organizationId: identity.organizationId, role: { in: ['manager', 'cleaner', 'host', 'viewer'] },
      properties: { some: { property: propertyWhere } } };
    if (cursor) where = { AND: [where, { id: { gt: cursor.id } }] };
    return this.repository.snapshot(async snapshot => {
      const rows = await snapshot.staff(where, propertyWhere, limit + 1);
      const items = rows.slice(0, limit);
      const hasMore = rows.length > limit;
      const last = items.at(-1);
      const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ version: 1, id: last.id, name: '',
        scope: cursorScope, expiresAt: now.getTime() + CURSOR_TTL_MS } satisfies PageCursor)).toString('base64url') : null;
      return { staff: items.map(user => ({ id: user.id, name: user.displayName || user.email, email: user.email,
        role: normalizeRole(user.role), status: user.status, organization: user.organization,
        properties: user.properties.slice(0, MAX_READ_PROPERTIES).map(item => item.property),
        propertiesHasMore: user.properties.length > MAX_READ_PROPERTIES })),
        staffPage: { hasMore, nextCursor }, scopeVersion, snapshotAt: now.toISOString() };
    });
  }

  async calendar(identity: BackendIdentity, query: CalendarReadQuery = {}) {
    const now = this.now();
    const month = query.month ?? todayKst(now).slice(0, 7);
    const { first: rangeFrom, last: rangeTo } = calendarGridRange(month);
    const ids = requestedPropertyIds(query.propertyIds);
    return this.repository.snapshot(async snapshot => {
      const properties = await readProperties(snapshot, identity, ids, query.cleaner ? 'cleaning' : 'reservations');
      const propertyIds = properties.map(property => property.id);
      const cleaningIds = properties.filter(property => moduleAllowed(identity, 'cleaning', property)).map(property => property.id);
      const [events, bookings] = propertyIds.length ? await Promise.all([
        snapshot.events({ propertyId: { in: propertyIds }, type: { in: ['reservation', 'block'] },
          endDate: { gte: rangeFrom }, startDate: { lte: rangeTo },
          AND: [{ NOT: { tags: { has: 'inquiry' } } },
            { OR: [{ title: null }, { NOT: { title: { startsWith: '[문의]' } } }] }] }, MAX_READ_ROWS + 1),
        snapshot.bookings({ propertyId: { in: propertyIds }, status: 'confirmed',
          checkOut: { gte: rangeFrom }, checkIn: { lte: rangeTo } }, MAX_READ_ROWS + 1),
      ]) : [[], []];
      assertRowLimit(events.length + bookings.length);
      const stays = projectStays(events, bookings, !!query.cleaner);
      const linkedCheckouts = new Map<string, { propertyId: string; date: string }>();
      for (const stay of stays) if (stay.type === 'reservation' && cleaningIds.includes(stay.propertyId) && (stay.checkOut < rangeFrom || stay.checkOut > rangeTo)) {
        linkedCheckouts.set(`${stay.propertyId}:${stay.checkOut}`, { propertyId: stay.propertyId, date: stay.checkOut });
      }
      const cleanings = cleaningIds.length ? await snapshot.cleanings({ propertyId: { in: cleaningIds }, NOT: { status: 'cancelled' },
        OR: [{ date: { gte: rangeFrom, lte: rangeTo } }, ...linkedCheckouts.values()] }, MAX_READ_ROWS - events.length - bookings.length + 1) : [];
      assertRowLimit(events.length + bookings.length + cleanings.length);
      attachCleaning(stays, cleanings, new Set(cleaningIds));
      return { rangeFrom, rangeTo, coveredPropertyIds: propertyIds, cleaningPropertyIds: cleaningIds,
        linkedCheckoutCleaningsIncluded: cleaningIds.length === propertyIds.length,
        properties: properties.map(property => propertySummary(identity, property)), stays,
        cleanings: cleanings.map(projectCleaning), complete: true, snapshotAt: now.toISOString() };
    });
  }

  async today(identity: BackendIdentity, query: TodayReadQuery = {}) {
    const now = this.now();
    const date = dateInput(query.date, now);
    const ids = requestedPropertyIds(query.propertyIds);
    return this.repository.snapshot(async snapshot => {
      const properties = await readProperties(snapshot, identity, ids, 'reservations');
      const propertyIds = properties.map(property => property.id);
      const cleaningIds = properties.filter(property => moduleAllowed(identity, 'cleaning', property)).map(property => property.id);
      let events: EventReadRow[] = [];
      let bookings: BookingReadRow[] = [];
      let cleanings: CleaningReadRow[] = [];
      if (propertyIds.length) {
        [events, bookings] = await Promise.all([
          snapshot.events({ propertyId: { in: propertyIds }, type: 'reservation',
            OR: [{ startDate: date }, { endDate: date }],
            AND: [{ NOT: { tags: { has: 'inquiry' } } },
              { OR: [{ title: null }, { NOT: { title: { startsWith: '[문의]' } } }] }] }, MAX_READ_ROWS + 1),
          snapshot.bookings({ propertyId: { in: propertyIds }, status: 'confirmed', OR: [{ checkIn: date }, { checkOut: date }] }, MAX_READ_ROWS + 1),
        ]);
        assertRowLimit(events.length + bookings.length);
        if (cleaningIds.length) cleanings = await snapshot.cleanings({ propertyId: { in: cleaningIds }, date, NOT: { status: 'cancelled' } }, MAX_READ_ROWS - events.length - bookings.length + 1);
        assertRowLimit(events.length + bookings.length + cleanings.length);
      }
      const stays = projectStays(events, bookings, false);
      attachCleaning(stays, cleanings, new Set(cleaningIds));
      for (const stay of stays) if (stay.checkOut !== date && cleaningIds.includes(stay.propertyId)) stay.cleaningMatch = 'deferred';
      const out = properties.map(property => {
        const checkins = stays.filter(stay => stay.propertyId === property.id && stay.checkIn === date);
        const checkouts = stays.filter(stay => stay.propertyId === property.id && stay.checkOut === date);
        const propertyCleanings = cleanings.filter(cleaning => cleaning.propertyId === property.id).map(projectCleaning);
        return { ...propertySummary(identity, property), checkins, checkouts, cleanings: propertyCleanings,
          hasWork: checkins.length > 0 || checkouts.length > 0 || propertyCleanings.length > 0,
          cleaningAvailable: cleaningIds.includes(property.id) };
      }).sort((a, b) => Number(b.hasWork) - Number(a.hasWork) || a.name.localeCompare(b.name));
      return { date, today: date, coveredPropertyIds: propertyIds, properties: out,
        deferredSections: ['conversation', 'delivery', 'checkoutSignals', 'cameras', 'assignees'],
        complete: true, snapshotAt: now.toISOString() };
    });
  }
}
