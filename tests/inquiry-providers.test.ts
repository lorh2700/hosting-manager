import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setFetchHandler, resetFetch, fetchLog, json } from './helpers/beds24-mock';
import { judgeInquiry, verifyInquiry, type InquiryContext } from '../lib/inquiry-ai';
import { confirmedBeds24Message, checkInquiryRemote, checkInquiryReservation, sendInquiryReply, sendInquiryKakao } from '../lib/inquiry-delivery';
import { invalidateBeds24Token } from '../lib/beds24';
import { resetDb } from './stubs/prisma';

const context: InquiryContext = { knowledge: '체크인은 오후 3시입니다.', reservation: { property: '한옥', checkIn: '2026-10-01', checkOut: '2026-10-03', adults: 2, children: 0 }, messages: [{ sender: 'guest', text: 'When is check-in?' }] };
const answer = { action: 'reply', category: 'checkin', draft: 'Check-in is at 3 PM.', summary: '체크인 시간 문의', reason: '안내문에 명시', evidence: ['체크인은 오후 3시입니다.'] };
const envelope = (value: unknown) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
beforeEach(() => { resetFetch(); resetDb(); invalidateBeds24Token(); process.env.OPENAI_API_KEY = 'test-key'; });

test('AI가 JSON 구조와 근거를 준수할 때만 reply, 요청은 서버 키와 store:false 사용', async () => {
  setFetchHandler(() => json(envelope(answer)));
  assert.equal((await judgeInquiry(context)).action, 'reply');
  assert.equal(fetchLog[0].body.store, false);
  assert.equal(fetchLog[0].body.text.format.strict, true);
  assert.equal(JSON.parse(fetchLog[0].body.input).reservation.property, '한옥');
  setFetchHandler(() => json(envelope({ ...answer, evidence: ['체크인은 오후 1시입니다.'] })));
  assert.equal((await judgeInquiry(context)).action, 'escalate');
});

test('거부·부분 출력·잘못된 JSON·HTTP 오류는 자동답변 판정에 사용하지 않는다', async () => {
  for (const response of [
    { status: 'incomplete', output: [] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{bad' }] }] },
    envelope({ ...answer, action: 'invented-action' }),
  ]) { setFetchHandler(() => json(response)); await assert.rejects(judgeInquiry(context)); }
  setFetchHandler(() => json({}, 429)); await assert.rejects(judgeInquiry(context));
  setFetchHandler(() => json(envelope({ safe: false }))); assert.equal(await verifyInquiry(context, 'unsupported'), false);
});

test('Beds24 HTTP 성공만으로 접수 성공으로 간주하지 않는다', async () => {
  assert.equal(confirmedBeds24Message([{ success: false, error: 'rejected' }]), null);
  assert.equal(confirmedBeds24Message({ success: true }), null);
  assert.deepEqual(confirmedBeds24Message([{ success: true, new: { id: 99 } }]), { messageId: '99' });
  assert.deepEqual(confirmedBeds24Message([{ success: true, info: [{ message: 'message sent' }] }]), { messageId: null });
  assert.equal(confirmedBeds24Message([{ success: true, errors: [{ message: 'error' }] }]), null);
  setFetchHandler(url => url.pathname.includes('authentication') ? json({ token: 't', expiresIn: 86400 }) : json([{ success: false }]));
  await assert.rejects(sendInquiryReply('77', 'hello'));
  assert.equal(fetchLog.filter(item => item.method === 'POST').length, 1);
});

test('전송 전 플랫폼 새 답변·페이지 누락을 발견하면 전송하지 않는다', async () => {
  const guest = { id: 101, source: 'guest', time: '2026-10-01T03:00:00Z' };
  let messages = [guest];
  let hasNext = false;
  setFetchHandler(url => url.pathname.includes('authentication') ? json({ token: 't', expiresIn: 86400 }) : json({ data: messages, pages: { nextPageExists: hasNext } }));
  assert.equal(await checkInquiryRemote('77', '101'), 'unchanged');
  messages = [guest, { id: 102, source: 'host', time: '2026-10-01T03:00:01Z' }];
  assert.equal(await checkInquiryRemote('77', '101'), 'changed');
  messages = [guest]; hasNext = true;
  assert.equal(await checkInquiryRemote('77', '101'), 'changed');
});

test('예약 재확인은 숙소·예약 번호·기간·인원·취소 상태를 검증한다', async () => {
  const booking = { id: 77, propertyId: 123, arrival: context.reservation.checkIn, departure: context.reservation.checkOut, numAdult: 2, numChild: 0, status: 'confirmed' };
  setFetchHandler(url => url.pathname.includes('authentication') ? json({ token: 't', expiresIn: 86400 }) : json({ data: [booking] }));
  assert.equal(await checkInquiryReservation('77', '123', context.reservation), true);
  booking.status = 'cancelled'; assert.equal(await checkInquiryReservation('77', '123', context.reservation), false);
});

test('카카오톡은 정확한 수신자·템플릿 변수로 접수하고 불명확한 응답을 구분한다', async () => {
  for (const key of ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_PFID', 'SOLAPI_FROM', 'SOLAPI_TPL_INQUIRY_ESCALATED']) process.env[key] = 'test';
  const input = { phone: '01012345678', name: '담당자', property: '한옥', guest: '게스트', summary: '환불 문의', reason: '예외 요청', url: 'https://voidanchae.com/admin/messages?eventId=e1' };
  setFetchHandler(() => json({ messageId: 'M1', statusCode: '2000' }));
  assert.equal((await sendInquiryKakao(input)).status, 'accepted');
  const message = fetchLog[0].body.message;
  assert.equal(message.to, input.phone); assert.equal(message.kakaoOptions.variables['#{상담링크}'], input.url);
  assert.equal(message.kakaoOptions.disableSms, true);
  setFetchHandler(() => json({}, 503)); assert.equal((await sendInquiryKakao(input)).status, 'unknown');
  setFetchHandler(() => json({}, 400)); assert.equal((await sendInquiryKakao(input)).status, 'failed');
  setFetchHandler(() => { throw new Error('timeout'); }); assert.equal((await sendInquiryKakao(input)).status, 'unknown');
});
