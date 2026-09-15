import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { normalizeRole, getVisiblePropertyIds } from '@/lib/access';
import { withAuth, ok, created, fail, readJson } from '@/lib/core/http';
import { phoneSchema } from '@/lib/inquiry-notification-settings';
import { phoneToSyntheticEmail, isSyntheticEmail } from '@/lib/phone';

export const GET = withAuth('staff/list', async (_req, { auth }) => {
  if (auth.role === 'cleaner') throw fail(403, '직원 관리 권한이 없습니다.');
  const [users, cleaners, visible] = await Promise.all([
    auth.role === 'admin' ? prisma.user.findMany({ select: { id: true, displayName: true, email: true, phone: true, role: true, status: true, properties: { select: { propertyId: true } } } }) : Promise.resolve([]),
    prisma.cleaner.findMany({ where: auth.role === 'admin' ? {} : { ownerId: auth.session.userId }, include: { user: { select: { id: true, displayName: true, email: true, phone: true, role: true, status: true } }, assignments: { select: { propertyId: true } } } }),
    getVisiblePropertyIds(auth),
  ]);
  const properties = await prisma.property.findMany({ where: visible === null ? {} : { id: { in: visible } }, select: { id: true, name: true, ownerId: true }, orderBy: { name: 'asc' } });
  const linked = new Set(cleaners.map(c => c.userId).filter(Boolean));
  const rows = users.filter(user => !linked.has(user.id)).map(user => ({
    key: `user:${user.id}`, userId: user.id, cleanerId: null as string | null, name: user.displayName || user.email,
    email: isSyntheticEmail(user.email) ? '' : user.email, phone: user.phone || '', role: normalizeRole(user.role), status: user.status,
    propertyIds: user.properties.map(p => p.propertyId), scope: normalizeRole(user.role) === 'admin' ? 'all' : user.properties.length ? 'selected' : 'none',
    ownerId: null as string | null, notifyNewOpen: false, publicToken: null as string | null, loginIdentifier: user.email,
  }));
  rows.push(...cleaners.map(c => ({
    key: `cleaner:${c.id}`, userId: c.userId || '', cleanerId: c.id, name: c.name, email: c.user && !isSyntheticEmail(c.user.email) ? c.user.email : '',
    phone: c.phone || '', role: normalizeRole(c.user?.role || 'cleaner'), status: c.user?.status || 'no_account',
    propertyIds: c.assignments.map(p => p.propertyId), scope: c.noProperties ? 'none' : c.assignments.length ? 'selected' : 'all',
    ownerId: c.ownerId, notifyNewOpen: c.notifyNewOpen, publicToken: c.publicToken, loginIdentifier: c.user ? (isSyntheticEmail(c.user.email) ? c.phone || '' : c.user.email) : '',
  })));
  return ok({ staff: rows.sort((a, b) => a.name.localeCompare(b.name, 'ko')), properties });
});

const cleanerSchema = z.object({
  name: z.string().trim().min(1).max(100), phone: phoneSchema,
  mode: z.enum(['all', 'selected', 'none']), propertyIds: z.array(z.string().min(1)).max(200),
  loginEnabled: z.boolean(), notifyNewOpen: z.boolean(),
}).strict();

/** Register a cleaner profile and optional login atomically; retain the original profile IDs. */
export const POST = withAuth('staff/create-cleaner', async (req, { auth }) => {
  if (auth.role === 'cleaner') throw fail(403, '직원 등록 권한이 없습니다.');
  const parsed = cleanerSchema.safeParse(await readJson(req));
  if (!parsed.success) throw fail(400, parsed.error.issues[0]?.message || '직원 정보를 확인해 주세요.');
  const { name, phone, mode, loginEnabled, notifyNewOpen } = parsed.data;
  const propertyIds = mode === 'selected' ? [...new Set(parsed.data.propertyIds)] : [];
  if (mode === 'selected' && !propertyIds.length) throw fail(400, '숙소를 한 곳 이상 선택해 주세요.');
  const visible = await getVisiblePropertyIds(auth);
  if (visible && propertyIds.some(id => !visible.includes(id))) throw fail(403, '관리할 수 있는 숙소만 배정할 수 있습니다.');
  if (propertyIds.length && await prisma.property.count({ where: { id: { in: propertyIds } } }) !== propertyIds.length) throw fail(400, '존재하지 않는 숙소입니다.');
  const email = phoneToSyntheticEmail(phone)!;
  if (await prisma.cleaner.findUnique({ where: { phone }, select: { id: true } }) || await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] }, select: { id: true } })) throw fail(409, '같은 연락처의 직원 또는 계정이 있습니다. 기존 직원을 확인해 주세요.');
  const initialPassword = loginEnabled ? randomBytes(12).toString('hex') : null;
  const password = initialPassword ? await bcrypt.hash(initialPassword, 12) : null;
  try {
    const cleaner = await prisma.$transaction(async tx => {
      const user = password ? await tx.user.create({ data: { email, password, displayName: name, phone, role: 'cleaner', status: 'active' } }) : null;
      const c = await tx.cleaner.create({ data: { name, phone, ownerId: auth.session.userId, userId: user?.id || null, publicToken: randomBytes(24).toString('base64url'), notifyNewOpen, noProperties: mode === 'none' } });
      if (propertyIds.length) await tx.cleanerProperty.createMany({ data: propertyIds.map(propertyId => ({ cleanerId: c.id, propertyId })) });
      return c;
    });
    return created({ cleanerId: cleaner.id, phone, initialPassword });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw fail(409, '이미 등록된 직원입니다.');
    throw error;
  }
});
