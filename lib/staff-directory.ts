import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { normalizeRole } from '@/lib/access';
import { getVisiblePropertyIds } from '@/lib/access';
import type { SessionAuth } from '@/lib/auth';
import { fail } from '@/lib/core/errors';

/** Legacy cleaner API names remain as DTO aliases only; every identity is a User. */
type DirectoryWhere = Omit<Prisma.UserWhereInput, 'AND' | 'OR' | 'NOT'> & {
  userId?: string; AND?: DirectoryWhere[]; OR?: DirectoryWhere[]; NOT?: DirectoryWhere;
};
type Options = { where?: DirectoryWhere; select?: unknown; include?: unknown; orderBy?: unknown; take?: number };
function where(input: DirectoryWhere = {}): Prisma.UserWhereInput {
  const { userId, AND, OR, NOT, ...rest } = input;
  return { ...rest, ...(userId ? { id: userId } : {}), ...(AND ? { AND: AND.map(where) } : {}), ...(OR ? { OR: OR.map(where) } : {}), ...(NOT ? { NOT: where(NOT) } : {}) };
}
async function findMany(options: Options = {}) {
  const users = await prisma.user.findMany({ where: where(options.where),
    select: { id: true, displayName: true, phone: true, email: true, role: true, status: true, ownerId: true, publicToken: true, notifyNewOpen: true, createdAt: true, properties: { select: { propertyId: true } } },
    orderBy: { displayName: 'asc' }, ...(options.take ? { take: options.take } : {}),
  });
  return users.map(user => ({
    id: user.id, userId: user.id, name: user.displayName || user.email, phone: user.phone,
    ownerId: user.ownerId, publicToken: user.publicToken, notifyNewOpen: user.notifyNewOpen,
    role: normalizeRole(user.role), status: user.status, createdAt: user.createdAt,
    noProperties: normalizeRole(user.role) !== 'admin' && user.properties.length === 0,
    assignments: user.properties, user: { id: user.id, displayName: user.displayName, phone: user.phone, email: user.email, role: user.role, status: user.status },
    invitations: [] as { id: string; email: string; token: string; expiresAt: Date }[],
  }));
}
async function findFirst(options: Options = {}) { return (await findMany({ ...options, take: 1 }))[0] ?? null; }
export const staffDirectory = { findMany, findFirst, findUnique: findFirst };

/** People assignable to this property, regardless of whether their role is manager or cleaner. */
export async function eligibleStaff(propertyId: string) {
  const users = await staffDirectory.findMany({ where: { status: { in: ['active', 'no_account'] } } });
  return users.filter(user => user.role === 'admin' || user.assignments.some(item => item.propertyId === propertyId));
}

export async function listAssignees(auth: SessionAuth, resolvedVisible?: string[] | null) {
  const visible = resolvedVisible === undefined ? await getVisiblePropertyIds(auth) : resolvedVisible;
  if (visible?.length === 0) return [];
  // Scope in SQL and fetch only assignment fields. A caller which already
  // checked its scope need not resolve the same identity/property links again.
  const users = await prisma.user.findMany({
    where: { status: { in: ['active', 'no_account'] }, ...(visible === null ? {} : {
      OR: [{ role: { in: ['admin', 'super_admin'] } }, { properties: { some: { propertyId: { in: visible } } } }],
    }) },
    select: { id: true, displayName: true, email: true, phone: true, role: true, properties: { select: { propertyId: true } } },
    orderBy: { displayName: 'asc' },
  });
  return users.filter(u => visible === null || normalizeRole(u.role) === 'admin' || u.properties.some(p => visible.includes(p.propertyId)))
    .map(u => ({ id: u.id, name: u.displayName || u.email, phone: u.phone, role: normalizeRole(u.role), assignedPropertyIds: u.properties.map(p => p.propertyId) }));
}

export async function requireAssignee(userId: string, propertyId: string) {
  if (!(await eligibleStaff(propertyId)).some(user => user.id === userId)) throw fail(400, '해당 숙소를 담당하는 사용 중인 직원만 배정할 수 있습니다.');
}
