import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const printed = [
  { token_hash: 'cddfc9c92ba57c7e793ba663edc60970bc5a202bbcca951ac0a79fe72873eaff', property_id: '70X0HKDJasPU3RQj67aU' },
  { token_hash: '99516806ab90e570b2fbe30c6aa50c13d262adfc189b1f7ccf1f21f73f9bb742', property_id: 'oKWKVQqLy7uENyHUwljr' },
  { token_hash: '70f4987938c580bff108acf2508563a9c7b1a4c6a892309a68617c6a5d4f6cda', property_id: 'Z4jFeng2zG9WpAhWtow3' },
  { token_hash: '8bc3e80d7dc7b35138bd381d59467cc150497fff9605f47638405af21027bd8d', property_id: 'c830c242-d1d5-4af1-9f68-43e2f5ae486a' },
  { token_hash: 'e6eac7ecdc6c5481df6aaf5684efe25acef047819580b16efedd9d7385ee0053', property_id: '5plQsEOe9sTHzSsMS0pc' },
];
const migration = () => readFile(new URL('../prisma/migrations/20261015020000_preserve_printed_checkout_qrs/migration.sql', import.meta.url), 'utf8');
async function fixture() {
  const sql = new PGlite();
  await sql.exec(await readFile(new URL('../prisma/migrations/20261013120000_guest_link_tokens/migration.sql', import.meta.url), 'utf8'));
  return sql;
}
const allTokens = async (sql: PGlite) => (await sql.query('SELECT * FROM guest_link_tokens ORDER BY token_hash')).rows;

test('printed checkout migration adds the four missing verified cards and is idempotent', async () => {
  const sql = await fixture();
  try {
    const invitations = (await sql.query("SELECT * FROM guest_link_tokens WHERE purpose='invitation' ORDER BY token_hash")).rows;
    await sql.exec(await migration());
    const checkout = (await sql.query<{token_hash:string;property_id:string;purpose:string;reservation_kind:string|null;reservation_id:string|null;expires_at:Date|null;revoked_at:Date|null}>("SELECT token_hash,property_id,purpose,reservation_kind,reservation_id,expires_at,revoked_at FROM guest_link_tokens WHERE purpose='checkout'")).rows;
    assert.equal(checkout.length, 5);
    for (const expected of printed) {
      assert.deepEqual(checkout.find(row => row.token_hash === expected.token_hash), {
        ...expected, purpose: 'checkout', reservation_kind: null, reservation_id: null, expires_at: null, revoked_at: null,
      });
    }
    assert.deepEqual((await sql.query("SELECT * FROM guest_link_tokens WHERE purpose='invitation' ORDER BY token_hash")).rows, invitations);
    const first = await allTokens(sql);
    await sql.exec(await migration());
    assert.deepEqual(await allTokens(sql), first);
  } finally { await sql.close(); }
});

test('printed checkout migration preserves existing revoked cards', async () => {
  const sql = await fixture();
  try {
    await sql.query('INSERT INTO guest_link_tokens(token_hash,purpose,property_id,revoked_at) VALUES($1,$2,$3,$4)',
      [printed[0].token_hash, 'checkout', printed[0].property_id, '2026-10-14T00:00:00Z']);
    const before = (await sql.query('SELECT * FROM guest_link_tokens WHERE token_hash=$1', [printed[0].token_hash])).rows;
    await sql.exec(await migration());
    assert.deepEqual((await sql.query('SELECT * FROM guest_link_tokens WHERE token_hash=$1', [printed[0].token_hash])).rows, before);
    assert.equal((await sql.query("SELECT * FROM guest_link_tokens WHERE purpose='checkout'")).rows.length, 5);
  } finally { await sql.close(); }
});

test('printed checkout migration leaves conflicting purpose and property identities unchanged', async () => {
  const sql = await fixture();
  try {
    await sql.query('INSERT INTO guest_link_tokens(token_hash,purpose,property_id,reservation_kind,reservation_id,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
      [printed[0].token_hash, 'invitation', 'fixture-other-property', 'event', '9f000000-0000-4000-8000-000000000001', '2030-01-01T00:00:00Z']);
    await sql.query('INSERT INTO guest_link_tokens(token_hash,purpose,property_id) VALUES($1,$2,$3)',
      [printed[1].token_hash, 'checkout', 'fixture-other-property']);
    const conflicts = (await sql.query('SELECT * FROM guest_link_tokens WHERE token_hash IN ($1,$2) ORDER BY token_hash', [printed[0].token_hash, printed[1].token_hash])).rows;
    await sql.exec(await migration());
    assert.deepEqual((await sql.query('SELECT * FROM guest_link_tokens WHERE token_hash IN ($1,$2) ORDER BY token_hash', [printed[0].token_hash, printed[1].token_hash])).rows, conflicts);
    assert.equal((await sql.query("SELECT * FROM guest_link_tokens WHERE purpose='checkout'")).rows.length, 4);
  } finally { await sql.close(); }
});
