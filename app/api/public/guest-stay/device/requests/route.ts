import { withErrors, fail } from '@/lib/core/http';
import { createGuestStayRequest, currentDeviceStay, guestStayRequests, privateStayResponse, readStayJson, requireDeviceStayProof, requireStayDevice, throttleStayAttempt } from '@/lib/guest-stay-store';
export const GET = withErrors('guest-stay/device/requests', async req => {
  const device = await requireStayDevice(req); const stay = await currentDeviceStay(device.propertyId);
  return privateStayResponse({ requests: stay ? await guestStayRequests(stay) : [] });
});
export const POST = withErrors('guest-stay/device/requests', async req => {
  const device = await requireStayDevice(req);
  await throttleStayAttempt(req, `device-request:${device.id}`, 30);
  const stay = await currentDeviceStay(device.propertyId);
  if (!stay) throw fail(403, '현재 투숙 중인 예약이 없습니다.', { code: 'stay_not_started' });
  const { stayProof, ...input } = await readStayJson(req);
  requireDeviceStayProof(device.id, stay, stayProof);
  const result = await createGuestStayRequest(stay, input, 'pad');
  return privateStayResponse(result, result.replayed ? 200 : 201);
});
