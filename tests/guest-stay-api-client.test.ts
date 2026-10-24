import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { transformSync } from 'esbuild';
import ts from 'typescript';

const source = ts.createSourceFile('GuestStayApp.tsx', readFileSync(new URL('../app/stay/GuestStayApp.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = source.statements.filter(node =>
  (ts.isClassDeclaration(node) && node.name?.text === 'ApiError') ||
  (ts.isFunctionDeclaration(node) && node.name?.text === 'api'));
assert.equal(declarations.length, 2);
const code = transformSync(declarations.map(node => node.getText(source)).join('\n') + '\n globalThis.request = api;', { loader: 'ts', target: 'es2017' }).code;

function harness() {
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  const calls: { url: string; options: RequestInit }[] = [];
  let respond = async (_signal: AbortSignal): Promise<Partial<Response>> => ({ ok: true, json: async () => ({ received: true }) });
  const caller = new AbortController();
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const add = caller.signal.addEventListener.bind(caller.signal);
  const remove = caller.signal.removeEventListener.bind(caller.signal);
  caller.signal.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
    if (!listener) return;
    listeners.add(listener);
    add(type, listener, options);
  };
  caller.signal.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
    if (!listener) return;
    listeners.delete(listener);
    remove(type, listener, options);
  };
  const context = createContext({
    AbortController,
    AbortSignal: {},
    setTimeout(callback: () => void, delay: number) {
      timers.set(++timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(id: number) { timers.delete(id); },
    fetch(url: string, options: RequestInit) {
      calls.push({ url, options });
      return respond(options.signal as AbortSignal);
    },
  });
  runInContext(code, context);
  return {
    request: context.request as (url: string, options?: RequestInit, signal?: AbortSignal) => Promise<Record<string, unknown>>,
    timers, calls, caller, listeners,
    setResponse(fn: typeof respond) { respond = fn; },
    assertCleanedUp() { assert.equal(timers.size, 0); assert.equal(listeners.size, 0); },
  };
}

function waitForAbort(signal: AbortSignal): Promise<Partial<Response>> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Error('aborted'));
    else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

test('guest API works without AbortSignal.timeout/any and cleans up after success', async () => {
  const h = harness();
  const result = await h.request('/requests', { method: 'POST', body: '{"test":true}' }, h.caller.signal);
  assert.equal(result.received, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.method, 'POST');
  assert.equal(h.calls[0].options.body, '{"test":true}');
  assert.equal(h.calls[0].options.credentials, 'same-origin');
  assert.equal(h.calls[0].options.cache, 'no-store');
  h.assertCleanedUp();
  h.caller.abort();
  assert.equal(h.calls[0].options.signal?.aborted, false);
});

test('guest API cleans up after network failure', async () => {
  const h = harness();
  h.setResponse(async () => { throw new Error('offline'); });
  await assert.rejects(h.request('/requests', undefined, h.caller.signal), /offline/);
  h.assertCleanedUp();
});

test('guest API preserves server status and error code', async () => {
  const h = harness();
  h.setResponse(async () => ({ ok: false, status: 403, json: async () => ({ code: 'session_expired' }) }));
  await assert.rejects(h.request('/requests', undefined, h.caller.signal), (error: { status?: number; code?: string }) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, 'session_expired');
    return true;
  });
  h.assertCleanedUp();
});

test('guest API cancels an in-flight request when the caller aborts', async () => {
  const h = harness();
  h.setResponse(waitForAbort);
  const pending = h.request('/session', undefined, h.caller.signal);
  assert.equal(h.listeners.size, 1);
  h.caller.abort();
  await assert.rejects(pending, /aborted/);
  assert.equal(h.calls[0].options.signal?.aborted, true);
  h.assertCleanedUp();
});

test('guest API honors an already-aborted caller signal', async () => {
  const h = harness();
  h.setResponse(waitForAbort);
  h.caller.abort();
  await assert.rejects(h.request('/session', undefined, h.caller.signal), /aborted/);
  assert.equal(h.calls[0].options.signal?.aborted, true);
  h.assertCleanedUp();
});

test('guest API aborts after 15 seconds without requiring a caller signal', async () => {
  const h = harness();
  h.setResponse(waitForAbort);
  const pending = h.request('/requests');
  assert.equal(h.timers.size, 1);
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 15000);
  timer.callback();
  await assert.rejects(pending, /aborted/);
  assert.equal(h.calls[0].options.signal?.aborted, true);
  h.assertCleanedUp();
});
