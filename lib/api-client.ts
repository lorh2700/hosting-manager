/**
 * 공통 API 클라이언트 유틸리티
 * - 타입 안전한 fetch 래퍼
 * - 프로퍼티 이름 매핑 헬퍼
 */

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── GET 요청 ───────────────────────────────────────────────────────────────

export const api = {
  properties: {
    list: () => fetchJson<{ id: string; name: string }[]>('/api/properties'),
    get: (id: string) => fetchJson<Record<string, unknown>>(`/api/properties/${id}`),
  },
  bookings: {
    list: (params?: URLSearchParams) =>
      fetchJson<Record<string, unknown>[]>(`/api/bookings${params ? `?${params}` : ''}`),
  },
  events: {
    list: (params?: URLSearchParams) =>
      fetchJson<Record<string, unknown>[]>(`/api/events${params ? `?${params}` : ''}`),
  },
  cleanings: {
    list: (params?: URLSearchParams) =>
      fetchJson<Record<string, unknown>[]>(`/api/cleanings${params ? `?${params}` : ''}`),
  },
  cleaners: {
    list: () => fetchJson<Record<string, unknown>[]>('/api/cleaners'),
  },
  guests: {
    list: () => fetchJson<Record<string, unknown>[]>('/api/guests'),
  },
  messages: {
    list: (params?: URLSearchParams) =>
      fetchJson<Record<string, unknown>[]>(`/api/messages${params ? `?${params}` : ''}`),
  },
  supplyRequests: {
    list: (params?: URLSearchParams) =>
      fetchJson<Record<string, unknown>[]>(`/api/supply-requests${params ? `?${params}` : ''}`),
  },
  supplyTodos: {
    list: (params?: URLSearchParams) =>
      fetchJson<Record<string, unknown>[]>(`/api/supply-todos${params ? `?${params}` : ''}`),
  },
  cleaningApplications: {
    list: (params?: URLSearchParams) =>
      fetchJson<Record<string, unknown>[]>(`/api/cleaning-applications${params ? `?${params}` : ''}`),
  },
  cleaningIssues: {
    list: (params?: URLSearchParams) =>
      fetchJson<Record<string, unknown>[]>(`/api/cleaning-issues${params ? `?${params}` : ''}`),
  },
  users: {
    list: () => fetchJson<Record<string, unknown>[]>('/api/users'),
  },
  invitations: {
    list: () => fetchJson<Record<string, unknown>[]>('/api/invitations'),
  },
  dashboard: {
    get: () => fetchJson<Record<string, unknown>>('/api/dashboard'),
  },
};

// ─── 공통 mutation 헬퍼 ────────────────────────────────────────────────────

export async function apiPost<T = unknown>(url: string, data: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function apiPut<T = unknown>(url: string, data: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function apiDelete(url: string): Promise<void> {
  await fetchJson(url, { method: 'DELETE' });
}

// ─── 프로퍼티 이름 매핑 ────────────────────────────────────────────────────

export type PropertyNameMap = Record<string, string>;

export async function fetchPropertyNames(): Promise<PropertyNameMap> {
  const properties = await api.properties.list();
  return Object.fromEntries(properties.map(p => [p.id, p.name]));
}

export function enrichWithPropertyName<T extends { propertyId: string }>(
  items: T[],
  propNames: PropertyNameMap,
): (T & { propertyName: string })[] {
  return items.map(item => ({
    ...item,
    propertyName: propNames[item.propertyId] ?? '알 수 없는 숙소',
  }));
}
