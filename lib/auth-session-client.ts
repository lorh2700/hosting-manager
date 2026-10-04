import type { UserRole, UserStatus } from './types';
import type { OperationalModule } from './operational-permissions';

export interface ClientAuthUser { id: string; email: string }
export interface ClientUserProfile {
  cleanerId?: string;
  role: UserRole;
  propertyIds: string[];
  displayName: string;
  phone?: string;
  status: UserStatus;
  organizationId?: string | null;
  organizationName?: string | null;
  enabledModules?: OperationalModule[];
  organizationFeatures?: unknown;
}

export type ClientSessionResult =
  | { kind: 'authenticated'; user: ClientAuthUser; profile: ClientUserProfile }
  | { kind: 'signed-out' }
  | { kind: 'unavailable'; error: string };

const unavailable = '계정 정보를 불러오지 못했습니다. 잠시 후 다시 불러와 주세요.';

/** Only a confirmed 401 clears the session; server failures are recoverable. */
export async function readClientSession(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<ClientSessionResult> {
  try {
    const response = await fetcher('/api/auth/me', { cache: 'no-store', signal: signal || AbortSignal.timeout(20_000) });
    if (response.status === 401) return { kind: 'signed-out' };
    const data = await response.json().catch(() => null);
    if (!response.ok) return {
      kind: 'unavailable',
      error: data?.migrationRequired
        ? '사업자·권한 설정의 데이터베이스 업데이트가 완료되지 않았습니다. 업데이트 후 다시 불러와 주세요.'
        : unavailable,
    };
    if (!data?.user?.id || !data.user.email || !data.profile?.role) return { kind: 'unavailable', error: unavailable };
    return { kind: 'authenticated', user: { id: data.user.id, email: data.user.email }, profile: data.profile };
  } catch {
    return { kind: 'unavailable', error: unavailable };
  }
}
