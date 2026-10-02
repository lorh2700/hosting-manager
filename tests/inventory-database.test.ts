import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { inventoryCountInput, saveInventoryCount } from '../lib/inventory';
import { prismaOverrides, resetDb } from './stubs/prisma';

// Local PostgreSQL adapter for the exact operations used by the domain transaction.
// Production still uses Prisma; no external database is accessed by this test.
type Sql = { query: (query: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
function inventoryClient(sql: Sql) {
  return {
    inventorySnapshot: {
      findUnique: async ({ where }: { where: { propertyId: string } }) => (await sql.query('SELECT property_id AS "propertyId", version, items FROM inventory_snapshots WHERE property_id=$1', [where.propertyId])).rows[0] ?? null,
      create: async ({ data }: { data: { propertyId: string; version: number; items: unknown; updatedAt: Date } }) => {
        await sql.query('INSERT INTO inventory_snapshots(property_id,version,items,updated_at) VALUES ($1,$2,$3::jsonb,$4)', [data.propertyId, data.version, JSON.stringify(data.items), data.updatedAt]);
      },
      updateMany: async ({ where, data }: { where: { propertyId: string; version: number }; data: { version: number; items: unknown; updatedAt: Date } }) => {
        const result = await sql.query('UPDATE inventory_snapshots SET version=$3,items=$4::jsonb,updated_at=$5 WHERE property_id=$1 AND version=$2 RETURNING property_id', [where.propertyId, where.version, data.version, JSON.stringify(data.items), data.updatedAt]);
        return { count: result.rows.length };
      },
    },
    inventoryCountRecord: {
      findUnique: async ({ where }: { where: { id: string } }) => (await sql.query('SELECT id,property_id AS "propertyId",request_hash AS "requestHash",version,result_items AS "resultItems" FROM inventory_count_records WHERE id=$1', [where.id])).rows[0] ?? null,
      create: async ({ data }: { data: { id: string; propertyId: string; requestHash: string; baseVersion: number; version: number; items: unknown; resultItems: unknown; checkedById: string; checkedBy: string; checkedAt: Date } }) => {
        await sql.query('INSERT INTO inventory_count_records(id,property_id,request_hash,base_version,version,items,result_items,checked_by_id,checked_by,checked_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)', [data.id, data.propertyId, data.requestHash, data.baseVersion, data.version, JSON.stringify(data.items), JSON.stringify(data.resultItems), data.checkedById, data.checkedBy, data.checkedAt]);
      },
    },
  };
}

test('local PostgreSQL migration enforces immutable server-only records and atomic snapshot/audit saves', async () => {
  resetDb();
  const sql = new PGlite();
  try {
    await sql.exec("CREATE TABLE properties(id TEXT PRIMARY KEY); INSERT INTO properties VALUES ('p1'); CREATE ROLE anon; CREATE ROLE authenticated;");
    await sql.exec(await readFile(new URL('../prisma/migrations/20261002010000_inventory_counts/migration.sql', import.meta.url), 'utf8'));
    const client = inventoryClient(sql);
    prismaOverrides.inventoryCountRecord = client.inventoryCountRecord;
    prismaOverrides.$transaction = (run: (tx: ReturnType<typeof inventoryClient>) => Promise<unknown>) => sql.transaction(tx => run(inventoryClient(tx)));
    const first = inventoryCountInput.parse({ id: '18aa9e72-4728-4a64-bb38-d77d4a74dd02', propertyId: 'p1', version: 0, items: [{ name: '수건', quantity: 10 }, { name: '이불', quantity: 4 }] });
    const response = await saveInventoryCount(first, { id: 'worker', name: '담당자' });
    assert.equal(response.version, 1);
    const second = inventoryCountInput.parse({ ...first, id: '25aa9e72-4728-4a64-bb38-d77d4a74dd02', version: 1, items: [{ name: '수건', quantity: 0 }] });
    await saveInventoryCount(second, { id: 'worker', name: '담당자' });
    assert.deepEqual(await saveInventoryCount(first, { id: 'worker', name: '담당자' }), response);
    const snapshot = (await sql.query<{ version: number; items: { name: string; quantity: number }[] }>('SELECT version,items FROM inventory_snapshots')).rows[0];
    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.items.find(item => item.name === '수건')?.quantity, 0);
    assert.equal(snapshot.items.find(item => item.name === '이불')?.quantity, 4);
    await assert.rejects(sql.query('UPDATE inventory_count_records SET checked_by=$1', ['변경자']), /immutable/);
    await assert.rejects(sql.query('DELETE FROM inventory_count_records'), /immutable/);
    await sql.exec('SET ROLE anon');
    await assert.rejects(sql.query('SELECT * FROM inventory_snapshots'), /permission denied/);
    await assert.rejects(sql.query('SELECT * FROM inventory_count_records'), /permission denied/);
    await sql.exec('RESET ROLE; SET ROLE authenticated');
    await assert.rejects(sql.query('SELECT * FROM inventory_snapshots'), /permission denied/);
    await sql.exec('RESET ROLE');

    // Force the audit INSERT to fail after snapshot CAS to verify real rollback.
    await sql.exec("CREATE FUNCTION reject_inventory_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit insert failed'; END; $$; CREATE TRIGGER reject_inventory_test BEFORE INSERT ON inventory_count_records FOR EACH ROW EXECUTE FUNCTION reject_inventory_test();");
    const third = inventoryCountInput.parse({ ...first, id: '35aa9e72-4728-4a64-bb38-d77d4a74dd02', version: 2, items: [{ name: '수건', quantity: 99 }] });
    await assert.rejects(saveInventoryCount(third, { id: 'worker', name: '담당자' }), /audit insert failed/);
    const unchanged = (await sql.query('SELECT version,items FROM inventory_snapshots')).rows[0];
    assert.deepEqual(unchanged, snapshot);
    assert.equal((await sql.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM inventory_count_records')).rows[0].count, 2);
  } finally {
    resetDb();
    await sql.close();
  }
});
