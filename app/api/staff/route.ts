import { staffDirectory } from '@/lib/staff-directory';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getVisiblePropertyIds } from '@/lib/access';
import { withAuth, ok, created, fail, readJson } from '@/lib/core/http';
import { phoneSchema } from '@/lib/inquiry-notification-settings';
import { phoneToSyntheticEmail, isSyntheticEmail } from '@/lib/phone';

export const GET = withAuth('staff/list', async (_req, { auth }) => {
  if (auth.role === 'cleaner') throw fail(403, '직원 관리 권한이 없습니다.');
  const visible = await getVisiblePropertyIds(auth);
  const users = await staffDirectory.findMany({ where: auth.role === 'admin' ? {} : { OR: [{ id: auth.session.userId }, { ownerId: auth.session.userId, role: 'cleaner' }] } });
  const properties = await prisma.property.findMany({ where: visible === null ? {} : { id: { in: visible } }, select: { id: true, name: true, ownerId: true }, orderBy: { name: 'asc' } });
  return ok({ staff: users.map(u => ({ key: `user:${u.id}`, userId: u.id, cleanerId: u.id,
    name: u.name, phone: u.phone || '', email: isSyntheticEmail(u.user.email) || u.status === 'no_account' ? '' : u.user.email,
    role: u.role, roles: [u.role], status: u.status, propertyIds: u.assignments.map(p => p.propertyId), managementPropertyIds: u.assignments.map(p => p.propertyId),
    scope: u.role === 'admin' ? 'all' : u.assignments.length ? 'selected' : 'none', ownerId: u.ownerId,
    notifyNewOpen: u.notifyNewOpen, publicToken: u.publicToken, loginIdentifier: u.status === 'no_account' ? '' : isSyntheticEmail(u.user.email) ? u.phone : u.user.email,
  })), properties });
});

const cleanerSchema = z.object({
  name: z.string().trim().min(1).max(100), phone: phoneSchema,
  mode: z.enum(['all', 'selected', 'none']), propertyIds: z.array(z.string().min(1)).max(200),
  loginEnabled: z.boolean(), notifyNewOpen: z.boolean(),
}).strict();

/** Register a single User with a cleaner role and optional login credentials. */
export const POST = withAuth('staff/create-cleaner', async (req, { auth }) => {
  if (auth.role === 'cleaner') throw fail(403, '직원 등록 권한이 없습니다.');
  const parsed = cleanerSchema.safeParse(await readJson(req));
  if (!parsed.success) throw fail(400, parsed.error.issues[0]?.message || '직원 정보를 확인해 주세요.');
  const { name, phone, mode, loginEnabled, notifyNewOpen } = parsed.data;
  const visible = await getVisiblePropertyIds(auth);
  const propertyIds = mode === 'all' ? (visible ?? (await prisma.property.findMany({ select: { id: true } })).map(p => p.id)) : mode === 'selected' ? [...new Set(parsed.data.propertyIds)] : [];
  if (mode === 'selected' && !propertyIds.length) throw fail(400, '숙소를 한 곳 이상 선택해 주세요.');
  if (visible && propertyIds.some(id => !visible.includes(id))) throw fail(403, '관리할 수 있는 숙소만 배정할 수 있습니다.');
  if (propertyIds.length && await prisma.property.count({ where: { id: { in: propertyIds } } }) !== propertyIds.length) throw fail(400, '존재하지 않는 숙소입니다.');
  const email = phoneToSyntheticEmail(phone)!;
  if (await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] }, select: { id: true } })) throw fail(409, '같은 연락처의 직원 또는 계정이 있습니다. 기존 직원을 확인해 주세요.');
  const initialPassword = loginEnabled ? randomBytes(12).toString('hex') : null;
  const password = initialPassword ? await bcrypt.hash(initialPassword, 12) : null;
  try {
    const cleaner = await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email, password: password || '', displayName: name, phone, role: 'cleaner', status: password ? 'active' : 'no_account', ownerId: auth.session.userId, publicToken: randomBytes(24).toString('base64url'), notifyNewOpen } });
      if (propertyIds.length) await tx.userProperty.createMany({ data: propertyIds.map(propertyId => ({ userId: user.id, propertyId })) });
      return user;
    });
    return created({ cleanerId: cleaner.id, phone, initialPassword });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw fail(409, '이미 등록된 직원입니다.');
    throw error;
  }
});
