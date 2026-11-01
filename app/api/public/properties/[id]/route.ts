import { withErrors, ok } from '@/lib/core/http';
import { getPublicBookingProperty } from '@/lib/public-booking-property';

export const dynamic = 'force-dynamic';

export const GET = withErrors<{ id: string }>('public/properties/id', async (_req, { params }) => {
  const response = ok(await getPublicBookingProperty(params.id));
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
