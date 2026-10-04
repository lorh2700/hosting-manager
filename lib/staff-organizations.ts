export const STAFF_UNASSIGNED_SCOPE = '__unassigned__';
export const STAFF_PLATFORM_SCOPE = '__platform__';

type Organization = { id: string; name: string };
type StaffBusiness = { role: string; organizationId?: string | null; organizationName?: string | null };

export function staffOrganizationName(staff: StaffBusiness, organizations: Organization[] = []): string {
  if (staff.role === 'super_admin') return '전체 사업자 관리';
  if (!staff.organizationId) return '사업자 미배정';
  return staff.organizationName || organizations.find(item => item.id === staff.organizationId)?.name || '사업자 정보 확인 필요';
}

export function staffOrganizationKey(staff: StaffBusiness): string {
  return staff.role === 'super_admin' ? STAFF_PLATFORM_SCOPE : staff.organizationId || STAFF_UNASSIGNED_SCOPE;
}
