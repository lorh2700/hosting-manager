import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, HttpError } from '@/lib/core/errors';

const inventoryName = z.string().trim().min(1, '품목 이름을 입력해 주세요.').max(100)
  .refine(name => !/[\u0000-\u001f\u007f]/.test(name), '품목 이름을 확인해 주세요.')
  .transform(name => name.normalize('NFC'));
const quantity = z.number().int().min(0).max(10000);
const inputItem = z.object({ name: inventoryName, quantity }).strict();
export const inventoryCountInput = z.object({
  id: z.string().uuid().transform(id => id.toLowerCase()),
  propertyId: z.string().trim().min(1).max(200),
  version: z.number().int().min(0).max(2147483646),
  items: z.array(inputItem).min(1, '확인한 품목을 한 개 이상 입력해 주세요.').max(30, '한 번에 30개 품목까지 확인할 수 있습니다.')
    .refine(items => new Set(items.map(item => item.name)).size === items.length, '동일한 품목을 두 번 입력할 수 없습니다.'),
}).strict();
export type InventoryCountInput = z.infer<typeof inventoryCountInput>;

const storedItem = z.object({ name: inventoryName, quantity, checkedAt: z.string().datetime(), checkedBy: z.string().min(1) }).strict();
const storedItems = z.array(storedItem).max(100).refine(items => new Set(items.map(item => item.name)).size === items.length);
export type InventoryItem = z.infer<typeof storedItem>;
type Actor = { id: string; name: string };
const unavailableMessage = '재고 기록 저장소가 아직 준비되지 않았습니다. 관리자에게 재고 기능 설정을 요청해 주세요.';
const conflictMessage = '다른 담당자가 재고를 확인했습니다. 최신 재고를 불러온 뒤 다시 확인해 주세요.';

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

/** Only missing inventory tables trigger the setup fallback. Column, permission and connection errors remain errors. */
export function isInventoryStorageMissing(error: unknown) {
  const code = errorCode(error);
  if (code !== 'P2021' && code !== '42P01') return false;
  const details = error && typeof error === 'object'
    ? `${'message' in error ? error.message : ''} ${'meta' in error ? JSON.stringify(error.meta) : ''}` : '';
  return /inventory_snapshots|inventory_count_records|InventorySnapshot|InventoryCountRecord/.test(details);
}

export async function inventorySnapshot(propertyId: string | null) {
  try {
    // Check both tables even before a property is selected, without loading another property's stock.
    if (!propertyId) {
      await Promise.all([
        prisma.inventorySnapshot.findFirst({ select: { propertyId: true } }),
        prisma.inventoryCountRecord.findFirst({ select: { id: true } }),
      ]);
      return { version: 0, items: [], available: true };
    }
    const [snapshot] = await Promise.all([
      prisma.inventorySnapshot.findUnique({ where: { propertyId } }),
      prisma.inventoryCountRecord.findFirst({ select: { id: true } }),
    ]);
    if (!snapshot) return { version: 0, items: [], available: true };
    return { version: snapshot.version, items: storedItems.parse(snapshot.items), available: true };
  } catch (error) {
    if (isInventoryStorageMissing(error)) return { version: 0, items: [], available: false };
    throw error;
  }
}

function hashRequest(input: InventoryCountInput, actor: Actor) {
  const items = [...input.items].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return createHash('sha256').update(JSON.stringify({ propertyId: input.propertyId, version: input.version, items, actorId: actor.id })).digest('hex');
}

function originalResponse(record: { id: string; propertyId: string; requestHash: string; version: number; resultItems: unknown }, input: InventoryCountInput, requestHash: string) {
  if (record.propertyId !== input.propertyId || record.requestHash !== requestHash) throw fail(409, '이미 다른 내용으로 저장된 요청입니다. 최신 재고를 확인한 뒤 새 요청으로 저장해 주세요.');
  return { saved: true, id: record.id, version: record.version, items: storedItems.parse(record.resultItems) };
}

export async function saveInventoryCount(input: InventoryCountInput, actor: Actor) {
  const requestHash = hashRequest(input, actor);
  try {
    return await prisma.$transaction(async tx => {
      const existing = await tx.inventoryCountRecord.findUnique({ where: { id: input.id } });
      if (existing) return originalResponse(existing, input, requestHash);
      const snapshot = await tx.inventorySnapshot.findUnique({ where: { propertyId: input.propertyId } });
      if ((snapshot?.version ?? 0) !== input.version) throw fail(409, conflictMessage);
      const checkedAt = new Date();
      const confirmed = input.items.map(item => ({ ...item, checkedAt: checkedAt.toISOString(), checkedBy: actor.name }));
      const merged = new Map<string, InventoryItem>(storedItems.parse(snapshot?.items ?? []).map(item => [item.name, item]));
      // Counts replace only physically checked items. An omitted item is never reset to zero.
      for (const item of confirmed) merged.set(item.name, item);
      if (merged.size > 100) throw fail(400, '숙소별 재고는 100개 품목까지 기록할 수 있습니다.');
      const items = [...merged.values()];
      const version = input.version + 1;
      if (snapshot) {
        const changed = await tx.inventorySnapshot.updateMany({ where: { propertyId: input.propertyId, version: input.version }, data: { version, items, updatedAt: checkedAt } });
        if (changed.count !== 1) throw fail(409, conflictMessage);
      } else {
        // The property primary key arbitrates concurrent first counts; a loser cannot overwrite the winner.
        await tx.inventorySnapshot.create({ data: { propertyId: input.propertyId, version, items, updatedAt: checkedAt } });
      }
      await tx.inventoryCountRecord.create({ data: {
        id: input.id, propertyId: input.propertyId, requestHash, baseVersion: input.version, version,
        items: confirmed, resultItems: items, checkedById: actor.id, checkedBy: actor.name, checkedAt,
      } });
      return { saved: true, id: input.id, version, items };
    });
  } catch (error) {
    if (isInventoryStorageMissing(error)) throw fail(503, unavailableMessage);
    // A simultaneous retry or first count may hit a unique key after its competitor commits.
    if (errorCode(error) === 'P2002' || errorCode(error) === 'P2034' || error instanceof HttpError && error.status === 409) {
      const existing = await prisma.inventoryCountRecord.findUnique({ where: { id: input.id } });
      if (existing) return originalResponse(existing, input, requestHash);
      throw fail(409, conflictMessage);
    }
    throw error;
  }
}
