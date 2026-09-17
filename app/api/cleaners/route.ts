import { staffDirectory } from '@/lib/staff-directory';
import { getVisiblePropertyIds } from '@/lib/access';
import { withAuth, ok, fail, readJson } from '@/lib/core/http';
import { PUT as updateUser } from '@/app/api/users/route';
import { POST as createStaff } from '@/app/api/staff/route';

// Compatibility URL; IDs are users.id and no cleaners table is read or written.
export const GET = withAuth('staff/assignees', async (_req, { auth }) => {
  const visible = await getVisiblePropertyIds(auth);
  const users = await staffDirectory.findMany({ where: { status: { in: ['active', 'no_account'] } } });
  return ok(users.filter(u => visible === null || u.id === auth.session.userId || u.assignments.some(p => visible.includes(p.propertyId)) || (u.role === 'admin' && visible.length > 0)).map(u => ({
    id: u.id, userId: u.id, name: u.name, phone: u.phone, role: u.role, ownerId: u.ownerId,
    publicToken: auth.role === 'admin' || u.id === auth.session.userId || u.ownerId === auth.session.userId ? u.publicToken : null,
    notifyNewOpen: u.notifyNewOpen, createdAt: u.createdAt, assignedPropertyIds: u.assignments.map(p => p.propertyId),
    login: u.status === 'no_account' ? null : { email: u.user.email, status: u.status }, pendingInvitation: null,
  })));
});
export const PUT = withAuth('staff/legacy-update', async (req) => {
  const body = await readJson(req);
  const mapped = { ...body, ...(body.name !== undefined ? { displayName: body.name } : {}), ...(typeof body.loginEnabled === 'boolean' ? { status: body.loginEnabled ? 'active' : 'suspended' } : {}) };
  return updateUser(new Request(req, { body: JSON.stringify(mapped) }), { params: Promise.resolve({}) });
});
export const POST = withAuth('staff/legacy-create', async (req) => {
  const body = await readJson(req);
  return createStaff(new Request(req, { body: JSON.stringify({ name: body.name, phone: body.phone, mode: 'none', propertyIds: [], loginEnabled: false, notifyNewOpen: false }) }), { params: Promise.resolve({}) });
});
export const DELETE = withAuth('staff/legacy-delete', async () => { throw fail(409, '직원 관리에서 로그인 중지와 숙소 배정 해제를 사용해 주세요. 청소 이력은 유지됩니다.'); });
