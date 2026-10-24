type CommandStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface CommandErrorBody { error?: string; code?: string; retryable?: boolean; migrationRequired?: boolean }

export function createOperationsJsonClient(options: {
  fetcher?: typeof fetch;
  storage?: () => CommandStorage | undefined;
  randomId?: () => string;
} = {}) {
  const pending = new Map<string, string>();
  const storage = () => { try { return options.storage?.() ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined); } catch { return undefined; } };
  return async <T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<{ response: Response; data: T & CommandErrorBody }> => {
    const method = (init?.method || 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    headers.set('Content-Type', 'application/json');
    let fingerprint: string | undefined;
    if (!['GET', 'HEAD'].includes(method) && !headers.has('Idempotency-Key')) {
      if (init?.body !== undefined && typeof init.body !== 'string') throw new Error('설정 요청은 JSON 형식이어야 합니다.');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([url, method, init?.body || ''])));
      fingerprint = `hm-command:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
      let key = pending.get(fingerprint);
      try { key ||= storage()?.getItem(fingerprint) || undefined; } catch { /* Memory still preserves retries within this page. */ }
      key ||= (options.randomId || (() => crypto.randomUUID()))();
      pending.set(fingerprint, key);
      try { storage()?.setItem(fingerprint, key); } catch { /* Storage may be disabled by the browser. */ }
      headers.set('Idempotency-Key', key);
    }
    const response = await (options.fetcher || fetch)(url, { ...init, method, headers });
    const parsed: unknown = await response.json().catch(() => { throw new Error('처리 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요.'); });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('처리 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요.');
    const data = parsed as T & CommandErrorBody;
    const uncertain = response.status >= 500 || data.retryable === true || ['ACCESS_CHANGED', 'COMMAND_IN_PROGRESS', 'COMMAND_RESULT_UNAVAILABLE'].includes(data.code || '');
    if (fingerprint && (response.ok || !uncertain)) {
      pending.delete(fingerprint);
      try { storage()?.removeItem(fingerprint); } catch { /* The command result has already been confirmed. */ }
    }
    return { response, data };
  };
}

export const operationsJsonRequest = createOperationsJsonClient();
