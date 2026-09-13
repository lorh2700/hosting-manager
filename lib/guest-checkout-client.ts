export type GuestCheckoutStatus = {
  propertyName: string; date: string; confirmed: boolean; eligible: boolean; message: string | null;
};

// Opening the signed guest page is the checkout action. First get the server's
// date so an old open page cannot accidentally confirm a different day's stay.
export async function autoConfirmGuestCheckout(token: string, signal: AbortSignal, send: typeof fetch = fetch): Promise<GuestCheckoutStatus> {
  async function request(body: object) {
    signal.throwIfAborted();
    const response = await send('/api/public/guest-checkout', { method: 'POST', signal, cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, token }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '다시 시도해주세요. / Please try again.');
    signal.throwIfAborted();
    return data;
  }
  const status: GuestCheckoutStatus = await request({ action: 'status' });
  if (status.confirmed || !status.eligible) return status;
  const result = await request({ action: 'confirm', viewedDate: status.date, confirmedDeparture: true });
  if (result.confirmed !== true) throw new Error('퇴실 확인을 완료하지 못했습니다. / Please try again.');
  return { ...status, confirmed: true };
}
