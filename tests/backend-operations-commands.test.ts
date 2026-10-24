import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { Prisma } from '../generated/prisma/client';
import { createOperationsCommandRunner, type OperationsCommandActor } from '../packages/domain/operations/commands';

interface LocalSql {
  query<Row = Record<string, unknown>>(query: string, values?: unknown[]): Promise<{ rows: Row[]; affectedRows?: number }>;
}

function database(sql: LocalSql): Prisma.TransactionClient {
  const statement = (parts: TemplateStringsArray, values: unknown[]) => ({
    query: parts.reduce((result, part, index) => result + (index ? `$${index}` : '') + part, ''),
    values,
  });
  return {
    $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const input = statement(parts, values);
      return (await sql.query(input.query, input.values)).rows;
    },
    $executeRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const input = statement(parts, values);
      return (await sql.query(input.query, input.values)).affectedRows ?? 0;
    },
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) => (await sql.query('SELECT id,name,status,features,version FROM organizations WHERE id=$1', [where.id])).rows[0] ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => (await sql.query('SELECT id,name,status,features,version FROM organizations WHERE id=$1', [where.id])).rows[0],
      updateMany: async ({ where, data }: { where: { id: string; version: number }; data: { name?: string; features?: unknown } }) => ({ count: (await sql.query('UPDATE organizations SET name=COALESCE($3,name),features=COALESCE($4::jsonb,features),version=version+1 WHERE id=$1 AND version=$2 RETURNING id', [where.id, where.version, data.name ?? null, data.features === undefined ? null : JSON.stringify(data.features)])).rows.length }),
    },
    property: { findMany: async () => [] },
    user: { findUnique: async ({ where }: { where: { id: string } }) => (await sql.query('SELECT id,role,organization_id AS "organizationId" FROM users WHERE id=$1', [where.id])).rows[0] ?? null },
    auditLog: { create: async ({ data }: { data: { action: string } }) => sql.query('INSERT INTO command_test_audits(id,action) VALUES($1,$2)', [randomUUID(), data.action]) },
  } as unknown as Prisma.TransactionClient;
}

const originalActor: OperationsCommandActor = {
  role: 'super_admin', session: { userId: 'supervisor', expiresAt: 2_000_000_000 },
  user: { status: 'active', organizationId: null, displayName: '슈퍼매니저' },
};
const encryptionSecret = 'local-command-secret-32-characters-long';
const key = 'b2c6e852-cf51-4f5c-88ab-74802fc752ed';

async function fixture(extras: Pick<Parameters<typeof createOperationsCommandRunner<OperationsCommandActor>>[0], 'additionalOperations' | 'authorizeAdditional'> = {}) {
  const sql = new PGlite();
  await sql.exec("CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,organization_id TEXT); INSERT INTO users VALUES ('supervisor','super_admin',NULL); CREATE TABLE organizations(id TEXT PRIMARY KEY,name TEXT,status TEXT,features JSONB,version INTEGER); INSERT INTO organizations VALUES('org-one','원본','active','{}',1); CREATE TABLE command_test_audits(id TEXT PRIMARY KEY,action TEXT); CREATE ROLE anon; CREATE ROLE authenticated;");
  await sql.exec(await readFile(new URL('../prisma/migrations/20261005010000_backend_commands/migration.sql', import.meta.url), 'utf8'));
  const state = { actor: structuredClone(originalActor), externalRevision: 'initial', invocations: 0, failResult: false };
  const runner = createOperationsCommandRunner({
    transaction: run => sql.transaction(tx => {
      const client = database(tx);
      if (state.failResult) client.$executeRaw = (async () => { throw new Error('result storage unavailable'); }) as unknown as Prisma.TransactionClient['$executeRaw'];
      return run(client);
    }),
    refreshActor: async () => structuredClone(state.actor),
    accessRevision: async tx => {
      const result = await tx.$queryRaw<Array<{ version: number }>>`SELECT version FROM organizations WHERE id = 'org-one'`;
      return `${state.externalRevision}:${result[0].version}:${state.actor.role}`;
    },
    encryptionSecret,
    now: () => new Date('2026-10-05T00:00:00Z'),
    ...extras,
  });
  const command = (body: unknown = { version: 1, name: '변경' }, commandKey = key) => runner.executeCommand(
    originalActor, 'organization.update', commandKey, body, 'org-one',
    async (service, actor) => {
      state.invocations++;
      return service.updateOrganization(actor, 'org-one', body);
    },
  );
  return { sql, state, runner, command };
}

test('registered operational commands recheck target scope before replay and share the atomic transaction', async () => {
  let allowed = true;
  let checks = 0;
  const fx = await fixture({ additionalOperations: ['inventory.count'], authorizeAdditional: async (_tx, actor, operation, target) => {
    checks++;
    assert.equal(actor.role, 'manager');
    assert.equal(operation, 'inventory.count');
    assert.equal(target, 'org-one');
    if (!allowed) throw Object.assign(new Error('scope changed'), { status: 403 });
  } });
  fx.state.actor.role = 'manager';
  let invocations = 0;
  const run = () => fx.runner.executeCommand(fx.state.actor, 'inventory.count', key, { value: 1 }, 'org-one', async (_service, _actor, tx) => {
    invocations++;
    await tx.$executeRaw`UPDATE organizations SET version = version + 1 WHERE id = 'org-one'`;
    return { recorded: true };
  });
  try {
    await run();
    const replay = await run();
    assert.equal(replay.replayed, true);
    assert.equal(invocations, 1);
    allowed = false;
    await assert.rejects(run, { status: 403 });
    assert.equal(checks, 3);
    assert.equal((await fx.sql.query<{ version: number }>('SELECT version FROM organizations')).rows[0].version, 2);
    await assert.rejects(() => fx.command(), { status: 403 });
  } finally { await fx.sql.close(); }
});

test('additional commands cannot run without an explicit authorization handler', async () => {
  const fx = await fixture({ additionalOperations: ['inventory.count'] });
  let invoked = false;
  try {
    await assert.rejects(() => fx.runner.executeCommand(originalActor, 'inventory.count', key, {}, null, async () => { invoked = true; }), { status: 400 });
    assert.equal(invoked, false);
  } finally { await fx.sql.close(); }
});

test('command replay returns the prior result before stale version validation, and uses its post-change access revision', async () => {
  const { sql, state, command } = await fixture();
  try {
    const first = await command();
    const second = await command({ name: '변경', version: 1 });
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(second.commandId, first.commandId);
    assert.deepEqual(second.data, first.data);
    assert.equal(state.invocations, 1);
    assert.equal((await sql.query<{ version: number }>('SELECT version FROM organizations')).rows[0].version, 2);
    assert.equal((await sql.query('SELECT * FROM command_test_audits')).rows.length, 1);
  } finally { await sql.close(); }
});

test('reused keys with changed content and changed access are rejected without another mutation', async () => {
  const { sql, state, command } = await fixture();
  try {
    await command();
    await assert.rejects(command({ version: 1, name: '다른 요청' }), { status: 409, extra: { code: 'IDEMPOTENCY_KEY_REUSED', retryable: false } });
    state.externalRevision = 'changed';
    await assert.rejects(command(), { status: 409, extra: { code: 'ACCESS_CHANGED', retryable: false } });
    assert.equal(state.invocations, 1);
  } finally { await sql.close(); }
});

test('suspended or demoted callers cannot read an earlier privileged command result', async () => {
  const { sql, state, command } = await fixture();
  try {
    await command();
    state.actor.user.status = 'suspended';
    await assert.rejects(command(), { status: 401 });
    state.actor.user.status = 'active';
    state.actor.role = 'admin';
    state.actor.user.organizationId = 'other-business';
    state.actor.organizationStatus = 'active';
    await assert.rejects(command(), { status: 403 });
    assert.equal(state.invocations, 1);
  } finally { await sql.close(); }
});

test('command result storage failure rolls back business changes, activity and key reservation', async () => {
  const { sql, state, command } = await fixture();
  try {
    state.failResult = true;
    await assert.rejects(command(), /result storage unavailable/);
    assert.equal((await sql.query<{ version: number }>('SELECT version FROM organizations')).rows[0].version, 1);
    assert.equal((await sql.query('SELECT * FROM command_test_audits')).rows.length, 0);
    assert.equal((await sql.query('SELECT * FROM backend_commands')).rows.length, 0);
    state.failResult = false;
    assert.equal((await command()).replayed, false);
  } finally { await sql.close(); }
});

test('command result secrets are encrypted, bound to the command identity and protected from client SQL roles', async () => {
  const { sql, runner } = await fixture();
  try {
    const result = await runner.executeCommand(originalActor, 'organization.admin.invite', key, { email: 'guest@example.invalid' }, 'org-one', async () => ({ invitationUrl: 'https://example.invalid/invite/private-token' }));
    const stored = (await sql.query<{ result_ciphertext: string }>('SELECT result_ciphertext FROM backend_commands')).rows[0];
    assert.equal(stored.result_ciphertext.includes('private-token'), false);
    assert.equal(stored.result_ciphertext.includes('invitationUrl'), false);
    assert.equal(result.data.invitationUrl, 'https://example.invalid/invite/private-token');
    for (const role of ['anon', 'authenticated']) {
      await sql.exec(`SET ROLE ${role}`);
      await assert.rejects(sql.query('SELECT * FROM backend_commands'), /permission denied/);
      await sql.exec('RESET ROLE');
    }
    await assert.rejects(sql.query('DELETE FROM backend_commands'), /must be retained/);
    await assert.rejects(sql.query("UPDATE backend_commands SET request_hash='replacement'"), /must be retained/);
  } finally { await sql.close(); }
});

test('two submissions sharing one key complete the business update once', async () => {
  const { sql, state, command } = await fixture();
  try {
    const results = await Promise.all([command(), command()]);
    assert.equal(state.invocations, 1);
    assert.equal(results.filter(result => result.replayed).length, 1);
    assert.equal(new Set(results.map(result => result.commandId)).size, 1);
  } finally { await sql.close(); }
});

test('an earlier staff result is hidden after the target changes business even when the caller revision is unchanged', async () => {
  const { sql, state, runner } = await fixture();
  try {
    await sql.query("INSERT INTO users VALUES('staff-one','host','org-one')");
    state.actor.role = 'admin';
    state.actor.user.organizationId = 'org-one';
    state.actor.organizationStatus = 'active';
    let called = 0;
    const command = () => runner.executeCommand(state.actor, 'user.access.update', key, { version: 1, enabledModules: [] }, 'staff-one', async () => { called++; return { id: 'staff-one' }; });
    await command();
    await sql.query("UPDATE users SET organization_id='other-business' WHERE id='staff-one'");
    await assert.rejects(command(), { status: 404 });
    assert.equal(called, 1);
  } finally { await sql.close(); }
});

test('ciphertext copied between command rows cannot be decrypted or trigger another execution', async () => {
  const { sql, runner } = await fixture();
  try {
    let called = 0;
    const command = (commandKey: string) => runner.executeCommand(originalActor, 'organization.admin.invite', commandKey, { email: 'guest@example.invalid' }, 'org-one', async () => { called++; return { invitationUrl: `https://example.invalid/invite/token-${called}` }; });
    const first = await command(key);
    const second = await command(randomUUID());
    await sql.exec('DROP TRIGGER backend_commands_retain ON backend_commands');
    await sql.query('UPDATE backend_commands SET result_ciphertext=(SELECT result_ciphertext FROM backend_commands WHERE id=$1) WHERE id=$2', [second.commandId, first.commandId]);
    await assert.rejects(command(key), { status: 503, extra: { code: 'COMMAND_RESULT_UNAVAILABLE', retryable: false } });
    assert.equal(called, 2);
  } finally { await sql.close(); }
});

test('missing command storage, missing encryption setup and invalid keys fail before changing data', async () => {
  const { sql, state, command, runner } = await fixture();
  try {
    await assert.rejects(command({ version: 1, name: '변경' }, 'short'), { status: 400 });
    const noSecret = createOperationsCommandRunner({
      transaction: run => sql.transaction(tx => run(database(tx))),
      refreshActor: async () => originalActor,
      accessRevision: async () => 'revision',
      encryptionSecret: '',
    });
    await assert.rejects(noSecret.executeCommand(originalActor, 'organization.create', key, {}, null, async () => ({})), { status: 503 });
    await sql.exec('DROP TABLE backend_commands');
    await assert.rejects(runner.executeCommand(originalActor, 'organization.create', key, {}, null, async () => ({})), { status: 503 });
    assert.equal(state.invocations, 0);
    assert.equal((await sql.query<{ version: number }>('SELECT version FROM organizations')).rows[0].version, 1);
  } finally { await sql.close(); }
});
