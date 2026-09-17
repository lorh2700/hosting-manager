import { withAuth, fail, readJson } from '@/lib/core/http';
import { PUT as updateUser } from '@/app/api/users/route';
export const PUT = withAuth<{ id: string }>('staff/properties', async (req, { params }) => {
  const body = await readJson(req);
  if (!['selected', 'none'].includes(String(body.mode))) throw fail(400, '담당 숙소를 선택하거나 배정 없음을 지정해 주세요. 전체 권한은 관리 역할에서 설정합니다.');
  return updateUser(new Request(req, { body: JSON.stringify({ id: params.id, propertyIds: body.mode === 'none' ? [] : body.propertyIds }) }), { params: Promise.resolve({}) });
});
