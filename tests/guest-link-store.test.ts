import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCipheriv, hkdfSync } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createGuestLinkStore, guestLinkHash, validGuestLinkToken, type GuestLinkDatabase } from '../lib/guest-link-store';
import { openInvitation } from '../lib/guest-invitation-token';

const reference = { kind: 'event' as const, id: '9f000000-0000-4000-8000-000000000001', propertyId: 'property-a', expires: Date.parse('2030-01-01') };
async function fixture() {
  const sql = new PGlite();
  await sql.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  await sql.exec(await readFile(new URL('../prisma/migrations/20261013120000_guest_link_tokens/migration.sql', import.meta.url), 'utf8'));
  const db: GuestLinkDatabase = { $queryRaw: async <T>(query: { text: string; values: unknown[] }) => (await sql.query(query.text, query.values)).rows as T };
  return { sql, store: createGuestLinkStore(db) };
}

test('opaque invitations and QR keep only a hash and enforce separate purposes and expiry', async () => {
  const { sql, store } = await fixture();
  try {
    const a = await store.issueInvitation(reference), b = await store.issueInvitation(reference), qr = await store.issueCheckout('property-a');
    assert.match(a, /^i2_[A-Za-z0-9_-]{22}$/); assert.notEqual(a, b); assert.match(qr, /^q1_[A-Za-z0-9_-]{43}$/);
    assert.deepEqual((await store.invitation(a, reference.expires - 1)).reference, reference);
    assert.deepEqual(await store.invitation(a, reference.expires), { found: true, reference: null });
    assert.deepEqual(await store.checkout(a), { found: true, propertyId: null });
    assert.deepEqual(await store.invitation(qr), { found: true, reference: null });
    assert.deepEqual(await store.checkout(qr), { found: true, propertyId: 'property-a' });
    const rows = (await sql.query('SELECT * FROM guest_link_tokens')).rows;
    assert.ok(!JSON.stringify(rows).includes(a)); assert.ok(!JSON.stringify(rows).includes(qr));
    assert.equal(rows.filter((r: any) => r.token_hash === guestLinkHash(a)).length, 1);
  } finally { await sql.close(); }
});

test('legacy hash registration is immutable across concurrent repeats, expiry extension and revocation', async () => {
  const { sql, store } = await fixture();
  try {
    const token = 'v2_' + 'z'.repeat(92);
    assert.deepEqual(await Promise.all([store.registerInvitation(token, reference), store.registerInvitation(token, reference)]), [true, true]);
    assert.equal(await store.registerInvitation(token, { ...reference, propertyId: 'property-b' }), false);
    assert.equal(await store.registerInvitation(token, { ...reference, expires: reference.expires + 86_400_000 }), false);
    assert.equal(await store.registerCheckout(token, 'property-a'), false);
    await assert.rejects(sql.query('UPDATE guest_link_tokens SET property_id=$1 WHERE token_hash=$2', ['property-b', guestLinkHash(token)]), /immutable/);
    await sql.query('UPDATE guest_link_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=$1', [guestLinkHash(token)]);
    assert.equal(await store.registerInvitation(token, reference), false);
    assert.deepEqual(await store.invitation(token), { found: true, reference: null });
    await assert.rejects(sql.query('UPDATE guest_link_tokens SET revoked_at=NULL WHERE token_hash=$1', [guestLinkHash(token)]), /immutable/);
  } finally { await sql.close(); }
});

test('migration contains only exact verified legacy aliases and denies public roles', async () => {
  const { sql } = await fixture();
  try {
    const rows = (await sql.query<{ purpose: string; property_id: string; expires_at: Date | null }>('SELECT purpose,property_id,expires_at FROM guest_link_tokens')).rows;
    assert.equal(rows.filter(r => r.purpose === 'invitation').length, 3);
    assert.equal(rows.filter(r => r.purpose === 'checkout').length, 1);
    assert.ok(rows.some(r => r.expires_at && new Date(r.expires_at).getTime() === 1800716400000));
    for (const role of ['anon', 'authenticated']) {
      await sql.exec(`SET ROLE ${role}`);
      await assert.rejects(sql.query('SELECT * FROM guest_link_tokens'), /permission denied/);
      await assert.rejects(sql.query('DELETE FROM guest_link_tokens'), /permission denied/);
      await sql.exec('RESET ROLE');
    }
  } finally { await sql.close(); }
});

test('unknown or modified tokens never resolve and persistence failure never yields a URL token', async () => {
  const { sql, store } = await fixture();
  try {
    const token = await store.issueInvitation(reference);
    assert.deepEqual(await store.invitation(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')), { found: false, reference: null });
    assert.deepEqual(await store.invitation(token + '\n'), { found: true, reference: null });
    const unavailable = createGuestLinkStore({ $queryRaw: async () => { throw Error('database offline'); } });
    await assert.rejects(unavailable.issueInvitation(reference), /database offline/);
    await assert.rejects(unavailable.issueCheckout('property-a'), /database offline/);
  } finally { await sql.close(); }
});

test('previous opaque invitations remain valid alongside short tokens without extending expiry', async () => {
  const { sql, store } = await fixture();
  try {
    const token = 'i1_' + 'k'.repeat(43);
    assert.equal(await store.registerInvitation(token, reference), true);
    assert.deepEqual((await store.invitation(token, reference.expires - 1)).reference, reference);
    assert.deepEqual(await store.invitation(token, reference.expires), { found: true, reference: null });
  } finally { await sql.close(); }
});

test('verified legacy recovery is scoped to the original stay and does not revive revoked links', async () => {
  const { sql } = await fixture();
  try {
    await sql.exec('CREATE TABLE events(id TEXT,property_id TEXT,type TEXT,channel_id TEXT,original_uid TEXT,start_date TEXT,end_date TEXT)');
    const migration = await readFile(new URL('../prisma/migrations/20261023010000_verified_invitation_recovery/migration.sql', import.meta.url), 'utf8');
    const hash = '194c6e6467223a72b2f6c826891058f31165ab2f2d564a6bad9bf801ebd15650';
    await sql.exec(migration);
    assert.equal((await sql.query('SELECT * FROM guest_link_tokens WHERE token_hash=$1', [hash])).rows.length, 0);
    await sql.exec("INSERT INTO events VALUES('86ab620a-3508-4855-adf1-4205ebb62eda','other-property','reservation','beds24','93826707','2026-10-23','2026-10-24')");
    await sql.exec(migration);
    assert.equal((await sql.query('SELECT * FROM guest_link_tokens WHERE token_hash=$1', [hash])).rows.length, 0);
    await sql.exec("UPDATE events SET property_id='Z4jFeng2zG9WpAhWtow3'");
    await sql.exec(migration);
    const rows = (await sql.query<{expires_at: Date}>('SELECT * FROM guest_link_tokens WHERE token_hash=$1', [hash])).rows;
    assert.equal(rows.length, 1); assert.equal(new Date(rows[0].expires_at).getTime(), 1795359600000);
    await sql.query('UPDATE guest_link_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=$1', [hash]);
    await sql.exec(migration);
    assert.ok((await sql.query('SELECT revoked_at FROM guest_link_tokens WHERE token_hash=$1', [hash])).rows[0].revoked_at);
  } finally { await sql.close(); }
});

test('legacy v1 random nonce can start with the new token prefix without losing compatibility', () => {
  const secret = 'fixture-only-v1-secret';
  for (const prefix of ['i1_', 'i2_', 'q1_']) {
    const nonce = Buffer.alloc(12);
    Buffer.from(prefix + 'A', 'base64url').copy(nonce);
    const key = Buffer.from(hkdfSync('sha256', secret, 'void-anchae', 'guest-invitation-v1', 32));
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from('guest-invitation-v1'));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(reference)), cipher.final()]);
    const token = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
    assert.ok(token.startsWith(prefix));
    assert.deepEqual(openInvitation(token, secret), reference);
    assert.equal(validGuestLinkToken(token), true);
  }
});
