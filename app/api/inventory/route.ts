import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, readJson, query, requireVisible, visibleScope } from '@/lib/core/http';
import { inventoryCountInput, inventorySnapshot, saveInventoryCount } from '@/lib/inventory';

export const GET = withAuth('inventory', async (req, { auth }) => {
  if (auth.user.status !== 'active') throw fail(401, '활성 계정으로 로그인해 주세요.');
  const propertyId = query(req, 'propertyId')?.trim() || null;
  if (propertyId) await requireVisible(auth, propertyId);
  const ids = await visibleScope(auth);
  const properties = await prisma.property.findMany({ where: ids === null ? {} : { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  if (propertyId && !properties.some(property => property.id === propertyId)) throw fail(404, '숙소를 찾을 수 없습니다.');
  return ok({ properties, ...await inventorySnapshot(propertyId) });
});

export const POST = withAuth('inventory', async (req, { auth }) => {
  if (auth.user.status !== 'active') throw fail(401, '활성 계정으로 로그인해 주세요.');
  const parsed = inventoryCountInput.safeParse(await readJson(req));
  if (!parsed.success) throw fail(400, parsed.error.issues[0]?.message || '재고 입력값을 확인해 주세요.');
  await requireVisible(auth, parsed.data.propertyId);
  if (!await prisma.property.findUnique({ where: { id: parsed.data.propertyId }, select: { id: true } })) throw fail(404, '숙소를 찾을 수 없습니다.');
  return ok(await saveInventoryCount(parsed.data, { id: auth.session.userId, name: auth.user.displayName || auth.user.email }));
});
