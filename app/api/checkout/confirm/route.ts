import { withAuth, ok, requireManage, readJson, str, DATE_RE } from '@/lib/core/http';
import { getCheckoutStatus, notifyCheckoutRecipients, recordCheckoutSignal } from '@/lib/checkout';
import { todayKst } from '@/lib/dates';

/**
 * 호스트의 "체크아웃 확인". 카드에서 한 번 누르면 host 신호를 남기고,
 * 처음 확인되는 경우 청소담당자에게 알림이 나간다. 이미 게스트가 눌러 확인된 날이면 신호만 추가된다.
 * Body: { propertyId, date? (YYYY-MM-DD, 기본 오늘 KST) }
 */
export const POST = withAuth('checkout/confirm', async (req, { auth, log }) => {
  const body = await readJson(req);
  const propertyId = str(body, 'propertyId', { required: true })!;
  requireManage(auth, propertyId);
  const rawDate = str(body, 'date');
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : todayKst();

  const rec = await recordCheckoutSignal({ propertyId, date, kind: 'host', note: auth.user.displayName || auth.user.email });
  let notified = 0;
  if (!rec.duplicate && rec.newlyConfirmed) {
    notified = (await notifyCheckoutRecipients({ propertyId, date, kind: 'host', at: rec.signal.at })).notified;
    log(`host confirmed checkout ${propertyId} ${date}: notified ${notified}`);
  }
  const status = await getCheckoutStatus(propertyId, date);
  return ok({ ...status, duplicate: rec.duplicate, notified });
});
