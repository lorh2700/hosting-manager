import { withErrors } from '@/lib/core/http';
import { deviceGuestStayQR, privateStayResponse, requireStayDevice, throttleStayAttempt } from '@/lib/guest-stay-store';
export const GET = withErrors('guest-stay/device', async req => {
  const device = await requireStayDevice(req);
  await throttleStayAttempt(req, `device-qr:${device.id}`, 60);
  return privateStayResponse(await deviceGuestStayQR(device));
});
