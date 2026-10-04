import { z } from 'zod';
import { withAuth, fail, requireManage } from '@/lib/core/http';
import { prisma } from '@/lib/prisma';
import { guestStayStatuses, guestStayTransitions } from '@/lib/guest-stay';
import { guestRequestDTO, privateStayResponse, readStayJson, requireStayOrigin } from '@/lib/guest-stay-store';
const schema = z.object({ status: z.enum(guestStayStatuses), publicReply: z.string().trim().max(2000), internalNote: z.string().trim().max(3000).optional(), version: z.number().int().positive() }).strict();
export const PATCH = withAuth<{ id: string }>('guest-stays/requests/update', async (req, { auth, params }) => {
  requireStayOrigin(req);
  const input = schema.safeParse(await readStayJson(req));
  if (!input.success) throw fail(400, '처리 내용을 확인해 주세요.');
  const request = await prisma.guestStayRequest.findUnique({ where: { id: params.id } });
  if (!request) throw fail(404, '신청을 찾을 수 없습니다.');
  requireManage(auth, request.propertyId);
  const previous = request.status as typeof guestStayStatuses[number];
  if (previous !== input.data.status && !guestStayTransitions[previous]?.includes(input.data.status)) throw fail(409, '완료·취소된 신청의 상태는 변경할 수 없습니다.');
  const updated = await prisma.guestStayRequest.updateMany({ where: { id: params.id, version: input.data.version }, data: { status: input.data.status,
    publicReply: input.data.publicReply, ...(input.data.internalNote === undefined ? {} : { internalNote: input.data.internalNote }), version: { increment: 1 }, updatedBy: auth.session.userId } });
  if (updated.count !== 1) throw fail(409, '다른 직원이 수정했습니다. 다시 불러와 주세요.', { code: 'version_conflict' });
  const row = await prisma.guestStayRequest.findUniqueOrThrow({ where: { id: params.id } });
  return privateStayResponse({ request: { ...guestRequestDTO(row), internalNote: row.internalNote } });
});
