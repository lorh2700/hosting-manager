import { renewInvitation } from '@/lib/invitation-lifecycle';
import { withAuth, ok } from '@/lib/core/http';

export const POST = withAuth<{ token: string }>('invitations/renew', async (req, { auth, params }) => ok(await renewInvitation(auth, params.token, new URL(req.url).origin)), { businessAdmin: true, audit: false });
