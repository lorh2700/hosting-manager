import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { buildSync } from 'esbuild';
import ts from 'typescript';

type Payload = { id: string; kind?: string; details?: Record<string, unknown>; [key: string]: unknown };
type BrowserCrypto = { getRandomValues?: typeof webcrypto.getRandomValues };
const secureCrypto = (): BrowserCrypto => ({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const paths = {
  stay: '../app/stay/GuestStayApp.tsx',
  pickup: '../app/guest/[slug]/GuestGuide.tsx',
};

function submitBundle(path: string) {
  const filename = fileURLToPath(new URL(path, import.meta.url));
  const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers: ts.FunctionDeclaration[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'submit') handlers.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(handlers.length, 1, `${path} must have one submit handler`);
  const imports = source.statements.filter(node => ts.isImportDeclaration(node)
    && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'uuid');
  // Execute the real handler with the browser dependency, without mounting unrelated React effects.
  return buildSync({ stdin: {
    contents: `${imports.map(node => node.getText(source)).join('\n')}\nglobalThis.submit = ${handlers[0].getText(source)};`,
    loader: 'tsx', sourcefile: filename, resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  }, bundle: true, platform: 'browser', format: 'iife', write: false }).outputFiles[0].text;
}
const bundles = { stay: submitBundle(paths.stay), pickup: submitBundle(paths.pickup) };

function stayHarness(kind: 'taxi' | 'tour', crypto: BrowserCrypto = secureCrypto()) {
  const calls: Payload[] = [];
  let respond: (payload: Payload) => Promise<{ request: Payload }> = async payload => ({ request: payload });
  const state = { sending: false, error: '', tab: '', notice: '' };
  const sendLock = { current: false };
  const pendingRequest = { current: null as null | { fingerprint: string; id: string } };
  const context = createContext({
    crypto, sendLock, pendingRequest, service: kind, stay: { requests: [] },
    preview: false, csrfToken: 'test-csrf', tourId: 'test-tour', tourDetail: { ticketTiers: [], durationOptions: [] },
    date: '2026-11-15', time: '09:00', people: 2, bags: 1, destination: 'Airport', note: '',
    durationOptionId: '', ticketCounts: {}, category: 'supplies', message: '',
    t: { received: 'received', previewReceived: 'preview' },
    setSending: (value: boolean) => { state.sending = value; },
    setSendError: (value: string) => { state.error = value; },
    showApiError: () => 'connection-error',
    setStay: (update: (value: unknown) => unknown) => { context.stay = update(context.stay); },
    setNotice: (value: string) => { state.notice = value; },
    setTab: (value: string) => { state.tab = value; },
    setService: (value: string | null) => { context.service = value; },
    setTime: () => {}, setNote: () => {}, setMessage: () => {}, setDestination: () => {}, setConsent: () => {},
    window: { scrollTo: () => {} },
    json: (body: unknown) => ({ body: JSON.stringify(body) }),
    api: async (url: string, options: { body: string }) => {
      assert.equal(url, '/api/public/guest-stay/requests');
      const payload = JSON.parse(options.body) as Payload;
      calls.push(payload);
      return respond(payload);
    },
  });
  runInContext(bundles.stay, context);
  return { state, calls, context, sendLock, pendingRequest,
    submit: () => context.submit({ preventDefault() {} }) as Promise<void>,
    respond: (value: typeof respond) => { respond = value; },
  };
}

function pickupHarness(crypto: BrowserCrypto = secureCrypto()) {
  const calls: Payload[] = [];
  const fields: Record<string, string> = {
    guestName: 'Test Guest', email: 'guest@example.test', phone: '01000000000', arrivalDate: '2026-11-15',
    arrivalTime: '09:00', flightNumber: 'TEST123', passengers: '2', luggage: '1', message: '', consent: 'on', website: '',
  };
  let respond: (payload: Payload) => Promise<{ ok: boolean; status: number; json: () => Promise<{ id: string }> }>
    = async payload => ({ ok: true, status: 200, json: async () => ({ id: payload.id }) });
  const state = { busy: false, error: null as number | null, receipt: '' };
  const submitted = { current: false }, requestId = { current: null as string | null }, payloadKey = { current: '' };
  const context = createContext({
    crypto, submitted, requestId, payloadKey, guide: { slug: 'anon' }, lang: 'zh',
    FormData: class {
      values: Record<string, string>;
      constructor(values: Record<string, string>) { this.values = values; }
      get(key: string) { return this.values[key] ?? null; }
    },
    setBusy: (value: boolean) => { state.busy = value; },
    setError: (value: number | null) => { state.error = value; },
    setReceipt: (value: string) => { state.receipt = value; },
    fetch: async (url: string, options: { body: string }) => {
      assert.equal(url, '/api/public/guest-services');
      const payload = JSON.parse(options.body) as Payload;
      calls.push(payload);
      return respond(payload);
    },
  });
  runInContext(bundles.pickup, context);
  return { state, calls, context, fields, submitted, requestId, payloadKey,
    submit: () => context.submit({ preventDefault() {}, currentTarget: fields }) as Promise<void>,
    respond: (value: typeof respond) => { respond = value; },
  };
}

for (const kind of ['taxi', 'tour'] as const) {
  test(`${kind} sends a valid request when the browser only supports getRandomValues`, async () => {
    const h = stayHarness(kind);
    assert.equal(h.context.crypto.randomUUID, undefined);
    await h.submit();
    assert.equal(h.calls.length, 1);
    assert.match(h.calls[0].id, uuidPattern);
    assert.equal(h.calls[0].kind, kind);
    assert.equal(h.calls[0].csrfToken, 'test-csrf');
    assert.equal(h.state.error, '');
    assert.equal(h.state.tab, 'requests');
    assert.equal(h.state.sending, false);
    assert.equal(h.sendLock.current, false);
  });

  test(`${kind} releases the submit lock and shows an error if UUID preparation fails`, async () => {
    const h = stayHarness(kind, {});
    await h.submit();
    assert.equal(h.calls.length, 0);
    assert.equal(h.state.error, 'connection-error');
    assert.equal(h.state.sending, false);
    assert.equal(h.sendLock.current, false);
    assert.equal(h.pendingRequest.current, null);
    h.context.crypto.getRandomValues = secureCrypto().getRandomValues;
    await h.submit();
    assert.equal(h.calls.length, 1);
    assert.match(h.calls[0].id, uuidPattern);
  });

  test(`${kind} does not send twice while the first submission is pending`, async () => {
    const h = stayHarness(kind);
    let resolve!: (value: { request: Payload }) => void;
    h.respond(() => new Promise(done => { resolve = done; }));
    const first = h.submit();
    await h.submit();
    assert.equal(h.calls.length, 1);
    assert.equal(h.sendLock.current, true);
    resolve({ request: h.calls[0] });
    await first;
    assert.equal(h.sendLock.current, false);
    assert.equal(h.state.sending, false);
  });
}

test('guest app retries reuse the request ID until the submitted details change', async () => {
  const h = stayHarness('taxi');
  h.respond(async () => { throw new Error('Connection lost after submission'); });
  await h.submit();
  await h.submit();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].id, h.calls[1].id);
  assert.equal(h.state.sending, false);
  h.context.destination = 'Seoul Station';
  await h.submit();
  assert.notEqual(h.calls[2].id, h.calls[1].id);
  h.respond(async payload => ({ request: payload }));
  await h.submit();
  assert.equal(h.calls[3].id, h.calls[2].id);
  assert.equal(h.pendingRequest.current, null);
  assert.equal(h.state.error, '');
});

test('invitation pickup submits without native randomUUID', async () => {
  const h = pickupHarness();
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].id, uuidPattern);
  assert.equal(h.calls[0].language, 'zh');
  assert.equal(h.state.receipt, h.calls[0].id);
  assert.equal(h.state.busy, false);
  assert.equal(h.submitted.current, false);
});

test('pickup UUID preparation failure can be retried without sending a null ID', async () => {
  const h = pickupHarness({});
  await h.submit();
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.error, 0);
  assert.equal(h.state.busy, false);
  assert.equal(h.submitted.current, false);
  h.context.crypto.getRandomValues = secureCrypto().getRandomValues;
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].id, uuidPattern);
  assert.equal(h.state.error, null);
});

test('pickup retries preserve the request ID and edited details receive a new ID', async () => {
  const h = pickupHarness();
  h.respond(async () => { throw new Error('Connection lost after submission'); });
  await h.submit();
  await h.submit();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].id, h.calls[1].id);
  h.fields.arrivalTime = '10:00';
  await h.submit();
  assert.notEqual(h.calls[2].id, h.calls[1].id);
  assert.equal(h.state.busy, false);
  assert.equal(h.submitted.current, false);
});

test('pickup prevents duplicate submissions while awaiting the response', async () => {
  const h = pickupHarness();
  let resolve!: (value: { ok: boolean; status: number; json: () => Promise<{ id: string }> }) => void;
  h.respond(() => new Promise(done => { resolve = done; }));
  const first = h.submit();
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.submitted.current, true);
  resolve({ ok: true, status: 200, json: async () => ({ id: h.calls[0].id }) });
  await first;
  assert.equal(h.submitted.current, false);
  assert.equal(h.state.busy, false);
});
