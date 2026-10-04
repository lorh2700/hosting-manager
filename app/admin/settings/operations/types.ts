import type { OperationalModule } from '@/lib/operational-permissions';

export type FeatureValues = Partial<Record<OperationalModule, boolean>>;
export interface Organization {
  id: string; name: string; status: string; features: FeatureValues; version: number; propertyIds: string[];
}
export interface ManagedProperty {
  id: string; name: string; organizationId: string | null; featureOverrides: FeatureValues; version: number;
}
export interface ManagedUser {
  id: string; displayName: string; email: string; role: string; status: string;
  organizationId: string | null; propertyIds: string[]; enabledModules: OperationalModule[] | null; version: number;
}
export interface OperationsSnapshot {
  viewer: { id: string; role: string; organizationId: string | null };
  organizations: Organization[]; properties: ManagedProperty[]; users: ManagedUser[];
}
export interface PropertyRequest {
  id: string; name: string; note?: string | null; status: string; organizationId: string;
  version: number; createdAt: string; decisionNote?: string | null; organization?: { name: string };
  propertyId?: string | null; requestedBy?: { displayName?: string } | string;
}

export const roleLabels: Record<string, string> = {
  super_admin: '슈퍼매니저', admin: '사업자 관리자', manager: '매니저', cleaner: '청소 담당자',
};
export const statusLabels: Record<string, string> = {
  active: '사용 중', inactive: '사용 중지', suspended: '사용 중지', pending_invite: '가입 대기', pending: '검토 대기',
  requested: '검토 대기', approved: '승인됨', rejected: '반려됨',
  no_account: '로그인 미발급',
};

/** Never silently turn a failed authorization or missing migration into an empty list. */
export async function operationsApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 409 && (!data.error || /다른 사용자가|새로고침/.test(data.error))) throw new Error('다른 사용자가 먼저 수정했습니다. 다시 불러온 뒤 변경 내용을 확인해 주세요.');
    if (data.migrationRequired) throw new Error('사업자·권한 설정을 사용하려면 서버의 데이터베이스 업데이트가 필요합니다.');
    throw new Error(data.error || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return data as T;
}

export function localDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
