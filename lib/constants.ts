import type { UserRole, UserStatus, IssueCategory, IssueUrgency, IssueStatus, SupplyRequestStatus } from './types';

// ─── 역할 ────────────────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: '슈퍼 어드민',
  admin: '관리자',
  host: '호스트',
  cleaner: '청소팀',
  viewer: '뷰어',
};

export const ADMIN_ROLES: UserRole[] = ['super_admin', 'admin'];

// ─── 사용자 상태 ─────────────────────────────────────────────────────────────

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  active: '활성',
  suspended: '비활성',
  pending_invite: '승인 대기',
};

// ─── 이슈 카테고리 ──────────────────────────────────────────────────────────

export const ISSUE_CATEGORY_LABELS: Record<IssueCategory, string> = {
  damage: '파손',
  malfunction: '고장',
  missing_item: '분실/부족',
  hygiene: '위생',
  other: '기타',
};

// ─── 긴급도 ──────────────────────────────────────────────────────────────────

export const URGENCY_LABELS: Record<IssueUrgency, { label: string; color: string }> = {
  low: { label: '낮음', color: 'text-white/40' },
  normal: { label: '보통', color: 'text-amber-400' },
  urgent: { label: '긴급', color: 'text-red-400' },
};

// ─── 이슈 상태 ──────────────────────────────────────────────────────────────

export const ISSUE_STATUS_CONFIG: Record<IssueStatus, { label: string; color: string; bg: string }> = {
  open: { label: '접수', color: 'text-amber-400', bg: 'bg-amber-500/20' },
  in_progress: { label: '처리중', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  resolved: { label: '해결', color: 'text-green-400', bg: 'bg-green-500/20' },
  closed: { label: '종료', color: 'text-white/30', bg: 'bg-white/5' },
};

// ─── 비품 요청 상태 ──────────────────────────────────────────────────────────

export const SUPPLY_STATUS_CONFIG: Record<SupplyRequestStatus, { label: string; color: string; bg: string }> = {
  pending: { label: '대기', color: 'text-amber-400', bg: 'bg-amber-500/20' },
  approved: { label: '승인', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  rejected: { label: '거절', color: 'text-red-400', bg: 'bg-red-500/20' },
  completed: { label: '완료', color: 'text-green-400', bg: 'bg-green-500/20' },
};

// ─── 이슈 상태 전이 ────────────────────────────────────────────────────────

export const ISSUE_NEXT_STATUS: Partial<Record<IssueStatus, IssueStatus>> = {
  open: 'in_progress',
  in_progress: 'resolved',
  resolved: 'closed',
};
