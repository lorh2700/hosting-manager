import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client';
import { z } from 'zod';
import { fail } from '../../../lib/core/errors';
import type { OperationalModule } from '../../../lib/operational-permissions';
import { assertOperationalAccess } from '../../../lib/operational-access';
import { fieldLaundryItems, inventoryCountSchema, laundryCreateSchema, laundryUpdateSchema, supplyCreateSchema, supplyUpdateSchema } from '../../contracts/field-operations';
import { moduleAllowed, propertyScopeWhere } from '../reads/policy';
import { auditData } from '../operations/audit';
import { applyReceipt, csvCell, currentSettlementMonth, laundryState, settlementPeriod } from './rules';
import type { CountItem, FieldActor, FieldDatabase, FieldHistory, FieldQuery, FieldTransaction, SettlementRow } from './types';

const PAGE_SIZE = 20;
const MAX_ROWS = 5000;
const propertySelect = { id: true, name: true, organizationId: true, featureOverrides: true, organization: { select: { status: true, features: true } } } as const;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const actorName = (actor: FieldActor) => (actor.user.displayName || actor.user.email || '담당자').slice(0, 100);
function parse<T>(schema: z.ZodType<T>, body: unknown): T { const result = schema.safeParse(body); if (!result.success) throw fail(400, result.error.issues[0]?.message || '입력값을 확인해 주세요.'); return result.data; }
function conflict(): never { throw fail(409, '다른 담당자가 변경했습니다. 최신 기록을 불러온 뒤 다시 저장해 주세요.'); }
function manager(actor: FieldActor) { if (!['super_admin', 'admin', 'manager'].includes(actor.role)) throw fail(403, '처리는 관리자 또는 매니저만 할 수 있습니다.'); }
function recorder(actor: FieldActor) { if (!['super_admin', 'admin', 'manager', 'cleaner'].includes(actor.role)) throw fail(403, '기록 권한이 없습니다.'); }
function cursor(value?: string | null) {
  if (!value) return null;
  try {
    if (value.length > 800 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return z.object({ id: z.string().min(1).max(100), at: z.string().datetime() }).strict().parse(parsed);
  } catch { throw fail(400, '목록을 처음부터 다시 불러와 주세요.'); }
}
function nextPage<T extends { id: string }>(rows: T[], at: (row: T) => Date) {
  const items = rows.slice(0, PAGE_SIZE), last = items.at(-1);
  return { items, page: { hasMore: rows.length > PAGE_SIZE, nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(JSON.stringify({ id: last.id, at: at(last).toISOString() })).toString('base64url') : null } };
}
function historyEntry(actor: FieldActor, at: Date, action: string, note?: string): FieldHistory { return { at: at.toISOString(), actorId: actor.session.userId, actor: actorName(actor), action, ...(note ? { note } : {}) }; }
function supplyMeta(items: unknown) { return object(object(list(items)[0])._fieldOperations); }
function supplyDto(row: { id: string; propertyId: string; requestedBy: string | null; requestedByName: string | null; items: unknown; urgency: string; status: string; statusNote: string | null; createdAt: Date }) {
  const entries = list(row.items).map(object), meta = supplyMeta(row.items);
  const requestText = entries.length === 1 && entries[0].kind === 'text' && typeof entries[0].text === 'string' ? entries[0].text
    : entries.map(item => `${String(item.name || '비품')} ${String(item.quantity ?? '')}${String(item.unit || '')}${item.note ? ` · ${String(item.note)}` : ''}`).join('\n');
  return { id: row.id, propertyId: row.propertyId, requestedBy: row.requestedBy, requestedByName: row.requestedByName, requestText,
    urgency: row.urgency, status: row.status, statusNote: row.statusNote, createdAt: row.createdAt.toISOString(), version: Number.isInteger(meta.version) ? Number(meta.version) : 0,
    processedBy: typeof meta.processedBy === 'string' ? meta.processedBy : null, processedAt: typeof meta.processedAt === 'string' ? meta.processedAt : null, history: list(meta.history) };
}

export function createFieldOperationsService(dependencies: { database: FieldDatabase; transaction: FieldTransaction; now?: () => Date }) {
  const db = dependencies.database, transaction = dependencies.transaction, now = dependencies.now || (() => new Date());
  async function scope(database: FieldDatabase, actor: FieldActor, module: OperationalModule, propertyId?: string | null) {
    assertOperationalAccess(actor, module);
    if (actor.user.status !== 'active') throw fail(401, '다시 로그인해 주세요.');
    if (propertyId && (propertyId.length > 100 || !propertyId.trim())) throw fail(400, '숙소를 선택해 주세요.');
    const rows = await database.property.findMany({ where: { AND: [propertyScopeWhere(actor), ...(propertyId ? [{ id: propertyId }] : [])] }, select: propertySelect, orderBy: { name: 'asc' }, take: 21 });
    if (rows.length > 20) throw fail(400, '숙소를 선택해 조회 범위를 줄여 주세요.');
    const allowed = rows.filter(property => moduleAllowed(actor, module, property));
    if (propertyId && !allowed.some(property => property.id === propertyId)) throw fail(404, '조회할 숙소를 찾을 수 없습니다.');
    return allowed;
  }
  async function audit(database: FieldDatabase, actor: FieldActor, module: OperationalModule, action: string, property: { id: string; organizationId: string | null }, targetId: string, summary: string) {
    await database.auditLog.create({ data: auditData(actor, { module, action, propertyId: property.id, organizationId: property.organizationId, targetType: module, targetId, summary }) });
  }
  async function readInventory(actor: FieldActor, query: FieldQuery = {}) {
    const properties = await scope(db, actor, 'inventory', query.propertyId);
    if (!query.propertyId) return { properties: properties.map(({ id, name }) => ({ id, name })), propertyId: null, version: 0, items: [], history: [], page: { hasMore: false, nextCursor: null } };
    const after = cursor(query.cursor);
    const [snapshot, records] = await Promise.all([
      db.inventorySnapshot.findUnique({ where: { propertyId: query.propertyId } }),
      db.inventoryCountRecord.findMany({ where: { propertyId: query.propertyId, ...(actor.role === 'cleaner' ? { checkedById: actor.session.userId } : {}),
        ...(after ? { OR: [{ checkedAt: { lt: new Date(after.at) } }, { checkedAt: new Date(after.at), id: { lt: after.id } }] } : {}) }, orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }], take: PAGE_SIZE + 1 }),
    ]);
    const page = nextPage(records, row => row.checkedAt);
    return { properties: properties.map(({ id, name }) => ({ id, name })), propertyId: query.propertyId, version: snapshot?.version ?? 0, items: snapshot?.items ?? [],
      history: page.items.map(row => ({ id: row.id, version: row.version, items: row.items, checkedBy: row.checkedBy, checkedAt: row.checkedAt.toISOString() })), page: page.page };
  }
  async function saveInventoryCount(actor: FieldActor, body: unknown) {
    recorder(actor); const input = parse(inventoryCountSchema, body);
    return transaction(async tx => {
      const [property] = await scope(tx, actor, 'inventory', input.propertyId);
      const snapshot = await tx.inventorySnapshot.findUnique({ where: { propertyId: input.propertyId } });
      if ((snapshot?.version ?? 0) !== input.version) conflict();
      const at = now(), id = randomUUID(), version = input.version + 1;
      const counted = input.items.map(item => ({ name: item.name.normalize('NFC'), quantity: item.quantity, checkedAt: at.toISOString(), checkedBy: actorName(actor) }));
      const merged = new Map(list(snapshot?.items).map(item => { const row = object(item); return [String(row.name), row as unknown as CountItem] as const; }));
      for (const item of counted) merged.set(item.name, item);
      if (merged.size > 100) throw fail(400, '숙소당 100개 품목까지 기록할 수 있습니다.');
      const items = [...merged.values()];
      if (snapshot) { const result = await tx.inventorySnapshot.updateMany({ where: { propertyId: input.propertyId, version: input.version }, data: { version, items: json(items), updatedAt: at } }); if (result.count !== 1) conflict(); }
      else await tx.inventorySnapshot.create({ data: { propertyId: input.propertyId, version, items: json(items), updatedAt: at } });
      await tx.inventoryCountRecord.create({ data: { id, propertyId: input.propertyId, baseVersion: input.version, version, requestHash: createHash('sha256').update(JSON.stringify({ input, actor: actor.session.userId })).digest('hex'), items: json(counted), resultItems: json(items), checkedById: actor.session.userId, checkedBy: actorName(actor), checkedAt: at } });
      await audit(tx, actor, 'inventory', 'inventory.count', property, id, `깨끗한 재고 ${counted.length}개 품목 확인`);
      return { saved: true, id, propertyId: input.propertyId, version, items };
    });
  }
  async function listLaundry(actor: FieldActor, query: FieldQuery = {}) {
    const properties = await scope(db, actor, 'laundry', query.propertyId), after = cursor(query.cursor);
    const rows = await db.laundryBatch.findMany({ where: { propertyId: { in: properties.map(property => property.id) }, ...(actor.role === 'cleaner' ? { createdBy: actor.session.userId } : {}),
      ...(after ? { OR: [{ createdAt: { lt: new Date(after.at) } }, { createdAt: new Date(after.at), id: { lt: after.id } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PAGE_SIZE + 1 });
    const page = nextPage(rows, row => row.createdAt);
    return { properties: properties.map(({ id, name }) => ({ id, name })), batches: page.items, page: page.page };
  }
  async function createLaundry(actor: FieldActor, body: unknown) {
    recorder(actor); const input = parse(laundryCreateSchema, body);
    return transaction(async tx => {
      const [property] = await scope(tx, actor, 'laundry', input.propertyId), at = now();
      const items = input.items.filter(item => item.quantity > 0).map(item => ({ name: item.name, sent: item.quantity, received: 0, damaged: 0, rewash: 0 }));
      const row = await tx.laundryBatch.create({ data: { id: randomUUID(), propertyId: input.propertyId, pickupDate: at.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }), deliveryDate: '', vendor: '', vendorPhone: '', status: 'collected', notes: input.notes, version: 1, createdBy: actor.session.userId, collectedAt: at,
        items: json(items), history: json([{ ...historyEntry(actor, at, '출고', input.notes), items, pickupDateSource: 'recorded' }]) } });
      await audit(tx, actor, 'laundry', 'laundry.create', property, row.id, '세탁 출고 기록');
      return row;
    });
  }
  async function updateLaundry(actor: FieldActor, id: string, body: unknown) {
    recorder(actor); const input = parse(laundryUpdateSchema, body);
    if (input.action === 'correct') manager(actor);
    return transaction(async tx => {
      const row = await tx.laundryBatch.findUnique({ where: { id } });
      if (!row) throw fail(404, '세탁 기록을 찾을 수 없습니다.');
      const [property] = await scope(tx, actor, 'laundry', row.propertyId);
      if (actor.role === 'cleaner' && row.createdBy !== actor.session.userId) throw fail(404, '세탁 기록을 찾을 수 없습니다.');
      if (row.version !== input.version) conflict();
      if (row.status === 'cancelled') throw fail(409, '취소된 세탁 기록은 변경할 수 없습니다.');
      let items = parse(fieldLaundryItems, row.items);
      if (input.action === 'receive') {
        if (!['collected', 'washing', 'shipping', 'partial'].includes(row.status)) throw fail(409, '입고 대기 기록만 입고 처리할 수 있습니다.');
        items = applyReceipt(items, input.full ? items.filter(item => item.sent > item.received).map(item => ({ name: item.name, quantity: item.sent - item.received, damaged: 0, rewash: 0 })) : input.incoming!);
      } else items = input.items!;
      if (row.status === 'scheduled' && items.some(item => item.received > 0)) throw fail(400, '수거 전에는 입고 수량을 기록할 수 없습니다.');
      const at = now(), status = row.status === 'scheduled' ? 'scheduled' : laundryState(items);
      const history = [...list(row.history), { ...historyEntry(actor, at, input.action === 'receive' ? '입고' : '수량 정정', input.note), before: row.items, items }];
      if (history.length > 1000) throw fail(409, '정정 이력이 많습니다. 관리자에게 확인해 주세요.');
      const result = await tx.laundryBatch.updateMany({ where: { id, version: input.version }, data: { version: input.version + 1, items: json(items), history: json(history), status, completedAt: status === 'completed' ? at : null } });
      if (result.count !== 1) conflict();
      await audit(tx, actor, 'laundry', `laundry.${input.action}`, property, id, input.action === 'receive' ? '세탁 입고 기록' : '세탁 수량 정정');
      return tx.laundryBatch.findUnique({ where: { id } });
    });
  }
  async function listSupplies(actor: FieldActor, query: FieldQuery = {}) {
    const properties = await scope(db, actor, 'supplies', query.propertyId), after = cursor(query.cursor);
    if (query.status && !['pending', 'approved', 'rejected', 'completed'].includes(query.status)) throw fail(400, '요청 상태를 확인해 주세요.');
    const rows = await db.supplyRequest.findMany({ where: { propertyId: { in: properties.map(property => property.id) }, ...(actor.role === 'cleaner' ? { requestedBy: actor.session.userId } : {}), ...(query.status ? { status: query.status } : {}),
      ...(after ? { OR: [{ createdAt: { lt: new Date(after.at) } }, { createdAt: new Date(after.at), id: { lt: after.id } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PAGE_SIZE + 1 });
    const page = nextPage(rows, row => row.createdAt);
    return { properties: properties.map(({ id, name }) => ({ id, name })), requests: page.items.map(supplyDto), page: page.page };
  }
  async function createSupply(actor: FieldActor, body: unknown) {
    recorder(actor); const input = parse(supplyCreateSchema, body);
    return transaction(async tx => {
      const [property] = await scope(tx, actor, 'supplies', input.propertyId), at = now();
      const row = await tx.supplyRequest.create({ data: { id: randomUUID(), propertyId: input.propertyId, requestedBy: actor.session.userId, requestedByName: actorName(actor), urgency: input.urgency, status: 'pending',
        items: json([{ kind: 'text', text: input.text.replace(/\r\n/g, '\n'), _fieldOperations: { version: 1, history: [historyEntry(actor, at, '요청')] } }]) } });
      await audit(tx, actor, 'supplies', 'supply.create', property, row.id, '비품 요청 등록');
      return supplyDto(row);
    });
  }
  async function updateSupply(actor: FieldActor, id: string, body: unknown) {
    manager(actor); const input = parse(supplyUpdateSchema, body);
    return transaction(async tx => {
      const row = await tx.supplyRequest.findUnique({ where: { id } });
      if (!row) throw fail(404, '비품 요청을 찾을 수 없습니다.');
      const [property] = await scope(tx, actor, 'supplies', row.propertyId), dto = supplyDto(row);
      if (dto.version !== input.version) conflict();
      const valid = row.status === 'pending' ? ['approved', 'rejected'] : row.status === 'approved' ? ['completed', 'rejected'] : [];
      if (!valid.includes(input.status)) throw fail(409, '요청 상태가 변경되었습니다. 현재 처리 단계를 확인해 주세요.');
      const at = now(), entries = list(row.items).map(object), action = input.status === 'approved' ? '승인' : input.status === 'rejected' ? '거절' : '지급 완료';
      const history = [...dto.history, historyEntry(actor, at, action, input.note)];
      if (history.length > 1000) throw fail(409, '처리 이력이 많습니다. 관리자에게 확인해 주세요.');
      entries[0] = { ...(entries[0] || { kind: 'text', text: dto.requestText }), _fieldOperations: { version: dto.version + 1, processedBy: actorName(actor), processedById: actor.session.userId, processedAt: at.toISOString(), history } };
      const result = await tx.supplyRequest.updateMany({ where: { id, status: row.status, statusNote: row.statusNote, urgency: row.urgency, items: { equals: row.items as Prisma.InputJsonValue } }, data: { status: input.status, statusNote: input.note || null, items: json(entries) } });
      if (result.count !== 1) conflict();
      await audit(tx, actor, 'supplies', 'supply.update', property, id, `비품 요청 ${action}`);
      return supplyDto({ ...row, status: input.status, statusNote: input.note || null, items: entries });
    });
  }
  async function settlement(actor: FieldActor, query: FieldQuery = {}) {
    manager(actor);
    const period = settlementPeriod(query.month || currentSettlementMonth(now()));
    return transaction(async tx => {
      const properties = await scope(tx, actor, 'settlement', query.propertyId), ids = properties.map(property => property.id), names = new Map(properties.map(property => [property.id, property.name]));
      const [cleanings, events, bookings] = await Promise.all([
        tx.cleaning.findMany({ where: { propertyId: { in: ids }, status: { in: ['pending', 'done'] }, date: { gte: period.from, lte: period.to } }, select: { id: true, propertyId: true, date: true, status: true, origin: true, cleanerId: true, cleaner: { select: { displayName: true } }, externalCleanerName: true }, orderBy: [{ date: 'asc' }, { id: 'asc' }], take: MAX_ROWS + 1 }),
        tx.event.findMany({ where: { propertyId: { in: ids }, type: 'reservation', endDate: { gte: period.from, lte: period.to }, AND: [{ NOT: { tags: { has: 'inquiry' } } }, { OR: [{ title: null }, { NOT: { title: { startsWith: '[문의]' } } }] }] }, select: { propertyId: true, endDate: true }, take: MAX_ROWS + 1 }),
        tx.booking.findMany({ where: { propertyId: { in: ids }, status: 'confirmed', checkOut: { gte: period.from, lte: period.to } }, select: { propertyId: true, checkOut: true }, take: MAX_ROWS + 1 }),
      ]);
      if ([cleanings, events, bookings].some(rows => rows.length > MAX_ROWS)) throw fail(400, '정산 건수가 많습니다. 숙소를 나누어 조회해 주세요.');
      const checkouts = new Set([...events.map(row => `${row.propertyId}:${row.endDate}`), ...bookings.map(row => `${row.propertyId}:${row.checkOut}`)]);
      const rows = new Map<string, SettlementRow>();
      const review: Array<{ id: string; date: string; propertyName: string; reason: string }> = [];
      const details: Array<{ id: string; date: string; propertyName: string; cleanerName: string; status: string }> = [];
      for (const cleaning of cleanings) {
        if (cleaning.origin === 'auto' && !checkouts.has(`${cleaning.propertyId}:${cleaning.date}`)) { if (cleaning.status === 'done') review.push({ id: cleaning.id, date: cleaning.date, propertyName: names.get(cleaning.propertyId) || '숙소', reason: '실제 퇴실 일정 확인 필요' }); continue; }
        if (!cleaning.cleanerId) { if (cleaning.status === 'done') review.push({ id: cleaning.id, date: cleaning.date, propertyName: names.get(cleaning.propertyId) || '숙소', reason: cleaning.externalCleanerName ? `외부 담당자 확인: ${cleaning.externalCleanerName}` : '담당자 확인 필요' }); continue; }
        const key = `${cleaning.cleanerId}:${cleaning.propertyId}`;
        const item = rows.get(key) || { cleanerId: cleaning.cleanerId, cleanerName: cleaning.cleaner?.displayName || '퇴사·미등록 담당자', propertyId: cleaning.propertyId, propertyName: names.get(cleaning.propertyId) || '숙소', done: 0, pending: 0, total: 0 };
        item.total++; if (cleaning.status === 'done') item.done++; else item.pending++;
        rows.set(key, item); details.push({ id: cleaning.id, date: cleaning.date, propertyName: item.propertyName, cleanerName: item.cleanerName, status: cleaning.status });
      }
      return { period, rows: [...rows.values()].sort((a, b) => a.cleanerName.localeCompare(b.cleanerName) || a.propertyName.localeCompare(b.propertyName)), review, details,
        totals: { done: [...rows.values()].reduce((sum, row) => sum + row.done, 0), pending: [...rows.values()].reduce((sum, row) => sum + row.pending, 0), review: review.length }, complete: true };
    });
  }
  async function exportSettlement(actor: FieldActor, query: FieldQuery = {}) {
    const result = await settlement(actor, query);
    const rows: unknown[][] = [['정산 시작', result.period.from, '정산 종료', result.period.to], ['담당자', '숙소', '완료', '대기', '합계'], ...result.rows.map(row => [row.cleanerName, row.propertyName, row.done, row.pending, row.total]), [], ['확인 필요', '날짜', '숙소', '사유'], ...result.review.map(row => ['집계 제외', row.date, row.propertyName, row.reason]), [], ['수행 날짜', '담당자', '숙소', '상태'], ...result.details.map(row => [row.date, row.cleanerName, row.propertyName, row.status === 'done' ? '완료' : '대기'])];
    return { filename: `청소정산_${result.period.month}.csv`, contentType: 'text/csv;charset=utf-8', content: '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') };
  }
  async function authorizeCommand(actor: FieldActor, routeId: string, targetId: string | null, body: unknown) {
    recorder(actor); const input = object(body);
    if (routeId === 'saveInventoryCount' || routeId === 'createLaundry' || routeId === 'createSupply') {
      if (typeof input.propertyId !== 'string' || !input.propertyId.trim()) throw fail(400, '숙소를 선택해 주세요.');
      await scope(db, actor, routeId === 'saveInventoryCount' ? 'inventory' : routeId === 'createLaundry' ? 'laundry' : 'supplies', input.propertyId);
      return;
    }
    if (!targetId) throw fail(400, '기록을 선택해 주세요.');
    if (routeId === 'updateLaundry') {
      if (input.action === 'correct') manager(actor);
      const row = await db.laundryBatch.findUnique({ where: { id: targetId } });
      if (!row || (actor.role === 'cleaner' && row.createdBy !== actor.session.userId)) throw fail(404, '세탁 기록을 찾을 수 없습니다.');
      await scope(db, actor, 'laundry', row.propertyId); return;
    }
    if (routeId === 'updateSupply') {
      manager(actor); const row = await db.supplyRequest.findUnique({ where: { id: targetId } });
      if (!row) throw fail(404, '비품 요청을 찾을 수 없습니다.');
      await scope(db, actor, 'supplies', row.propertyId); return;
    }
    throw fail(404, '지원하지 않는 변경 요청입니다.');
  }
  return { readInventory, saveInventoryCount, listLaundry, createLaundry, updateLaundry, listSupplies, createSupply, updateSupply, settlement, exportSettlement, authorizeCommand };
}
export type FieldOperationsService = ReturnType<typeof createFieldOperationsService>;
