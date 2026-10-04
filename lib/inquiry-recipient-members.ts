import { prisma } from '@/lib/prisma';
import { normalizeRole } from '@/lib/access';
import { phoneSchema } from '@/lib/inquiry-notification-settings';

/** Only active staff who can open this property's conversation may receive it. */
export async function getInquiryRecipientMembers(propertyId: string) {
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { organizationId: true } });
  if (!property) return [];
  const [users, assignments] = await Promise.all([
    prisma.user.findMany({ where: { status: 'active' }, select: { id: true, displayName: true, email: true, phone: true, role: true, organizationId: true }, orderBy: { displayName: 'asc' } }),
    prisma.userProperty.findMany({ where: { propertyId }, select: { userId: true } }),
  ]);
  const assigned = new Set(assignments.map(row => row.userId));
  return users.filter(user => normalizeRole(user.role) === 'super_admin' || ((user.organizationId || null) === (property.organizationId || null) && ((normalizeRole(user.role) === 'admin' && !!user.organizationId) || (normalizeRole(user.role) === 'manager' && assigned.has(user.id)))))
    .map(user => { const phone = phoneSchema.safeParse(user.phone); return { userId: user.id, name: user.displayName?.trim() || user.email, phone: phone.success ? phone.data : '', role: normalizeRole(user.role) }; });
}
