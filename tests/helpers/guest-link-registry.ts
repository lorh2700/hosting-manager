import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { calls, prismaOverrides } from '../stubs/prisma';

type RawStatement = TemplateStringsArray | { text: string; values: unknown[] };
export function guestLinkStatement(parts: RawStatement, values: unknown[] = []) {
  if (Array.isArray(parts)) return { text: parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, ''), values };
  return parts as { text: string; values: unknown[] };
}
export function installGuestLinkRegistry() {
  const queryRaw = prismaOverrides.$queryRaw;
  const executeRaw = prismaOverrides.$executeRaw;
  let connection: Promise<PGlite> | undefined;
  const sql = () => connection ??= (async () => {
    const database = new PGlite();
    const migration = await readFile(new URL('../../prisma/migrations/20261013120000_guest_link_tokens/migration.sql', import.meta.url), 'utf8');
    await database.exec(migration);
    return database;
  })();
  prismaOverrides.$queryRaw = async (parts: RawStatement, ...values: unknown[]) => {
    const query = guestLinkStatement(parts, values);
    if (!query.text.includes('guest_link_tokens')) return queryRaw ? queryRaw(parts, ...values) : [];
    calls.push(/^\s*INSERT/.test(query.text) ? 'guestLink.insert' : 'guestLink.read');
    return (await (await sql()).query(query.text, query.values)).rows;
  };
  prismaOverrides.$executeRaw = async (parts: RawStatement, ...values: unknown[]) => {
    const query = guestLinkStatement(parts, values);
    if (!query.text.includes('guest_link_tokens')) return executeRaw ? executeRaw(parts, ...values) : 0;
    return (await (await sql()).query(query.text, query.values)).affectedRows ?? 0;
  };
  return { sql, close: async () => { if (connection) await (await connection).close(); } };
}
