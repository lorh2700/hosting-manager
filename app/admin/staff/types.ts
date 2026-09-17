export type Scope = 'all' | 'selected' | 'none';
export type Role = 'admin' | 'manager' | 'cleaner';
export interface Staff { key: string; userId: string; cleanerId: string | null; name: string; email: string; phone: string; role: Role; roles: Role[]; managementPropertyIds: string[]; status: string; propertyIds: string[]; scope: Scope; ownerId: string | null; notifyNewOpen: boolean; publicToken: string | null; loginIdentifier: string }
export interface Property { id: string; name: string; ownerId: string }
export const field = 'mt-2 w-full border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30';
export const button = 'min-h-11 border border-stone-300 px-4 py-2 text-sm disabled:opacity-40';
export const roles = { admin: '관리자', manager: '매니저', cleaner: '청소 담당자' };
export const statuses: Record<string, string> = { active: '사용 중', suspended: '로그인 중지', pending_invite: '승인 대기', no_account: '계정 없음' };
export async function api(url: string, method?: string, body?: unknown) {
  const response = await fetch(url, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '요청을 처리하지 못했습니다.');
  return result;
}
