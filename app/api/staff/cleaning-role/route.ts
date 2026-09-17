import { withAuth, fail } from '@/lib/core/http';
export const POST = withAuth('staff/legacy', async () => { throw fail(410, '직원은 users에서 통합 관리합니다. 직원 목록을 새로고침해 주세요.'); });
