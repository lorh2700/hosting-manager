import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecordPayload, confirmedItems, createRecordDraft, draftStorageKey, parseQuantityInput, parseRecordDraft, validateRecordDraft, hasDraftContent, legacySendReference, quickSendNotes } from '../lib/operations-records';

const ID = '9c7b2c08-270f-4d2e-8fb3-5f9a18f706e9';

test('초안은 계정·숙소·기록 종류·테스트 여부를 각각 분리한다', () => {
  const keys = [draftStorageKey('user:a', 'p1', 'stock'), draftStorageKey('user:b', 'p1', 'stock'), draftStorageKey('user:a', 'p2', 'stock'), draftStorageKey('user:a', 'p1', 'send'), draftStorageKey('user:a', 'p1', 'stock', true)];
  assert.equal(new Set(keys).size, keys.length);
  assert.notEqual(draftStorageKey('a:b', 'c', 'stock'), draftStorageKey('a', 'b:c', 'stock'));
  assert.throws(() => draftStorageKey('', 'p1', 'stock'));
});

test('새 기록은 수량·단위·세탁업체·날짜를 자동으로 확정하지 않는다', () => {
  const stock = createRecordDraft('stock', ID), send = createRecordDraft('send', ID), supplies = createRecordDraft('supplies', ID);
  assert.equal(stock.items.length, 9); assert.ok(stock.items.every(row => row.quantity === null));
  assert.equal(send.vendor, ''); assert.equal(send.pickupDate, ''); assert.equal(send.deliveryDate, '');
  assert.equal(send.quickSend, true);
  assert.deepEqual(supplies.items, []); assert.equal(supplies.requestText, '');
  assert.equal(hasDraftContent(stock), false);
});

test('빈 수량은 미확인이며 0은 실제 확인한 수량이다', () => {
  assert.deepEqual(parseQuantityInput(''), { quantity: null, error: null });
  assert.deepEqual(parseQuantityInput('0'), { quantity: 0, error: null });
  for (const input of ['-1', '1.5', 'abc', '1e3', '10001']) assert.ok(parseQuantityInput(input).error);
  assert.deepEqual(confirmedItems([{ name: '수건', quantity: null }, { name: '시트', quantity: 0 }]), [{ name: '시트', quantity: 0 }]);
});

test('재고 기록은 확인한 총수량만 보내고 이전 값이나 세탁 증감을 합치지 않는다', () => {
  const draft = createRecordDraft('stock', ID); draft.items[0].quantity = 0; draft.items[2].quantity = 6;
  const payload = buildRecordPayload('p1', 'stock', draft, 3);
  assert.deepEqual(payload, { id: ID, propertyId: 'p1', version: 3, items: [{ name: '손수건', quantity: 0 }, { name: '작은수건', quantity: 6 }] });
  assert.throws(() => buildRecordPayload('p1', 'stock', draft));
});

test('비품 요청은 원문을 보내며 생수의 수량을 임의로 만들지 않는다', () => {
  const draft = createRecordDraft('supplies', ID);
  assert.ok(validateRecordDraft('supplies', draft));
  draft.requestText = '생수가 부족합니다.\n휴지와 쓰레기봉투도 부탁드립니다.';
  const payload = buildRecordPayload('p1', 'supplies', draft);
  assert.deepEqual(payload, { id: ID, propertyId: 'p1', text: draft.requestText, urgency: 'normal' });
  assert.equal('items' in payload, false);
  draft.requestText = ' \r\n '; assert.ok(validateRecordDraft('supplies', draft));
  draft.requestText = 'a'.repeat(2001); assert.ok(validateRecordDraft('supplies', draft));
});

test('간편 세탁 보냄은 양수 수량만 있으면 업체·날짜 없이 기록한다', () => {
  const draft = createRecordDraft('send', ID); draft.items[0].quantity = 2; draft.items[1].quantity = 0;
  assert.equal(validateRecordDraft('send', draft), null);
  assert.deepEqual(buildRecordPayload('p1', 'send', draft), { id: ID, propertyId: 'p1', quickSend: true,
    items: [{ name: '손수건', sent: 2, received: 0, damaged: 0, rewash: 0 }] });
  draft.items[0].quantity = 0; assert.ok(validateRecordDraft('send', draft));
  draft.items[0].quantity = null; assert.ok(validateRecordDraft('send', draft));
  draft.items[0].quantity = 3; draft.notes = '문 앞에서 전달했습니다.';
  assert.equal(buildRecordPayload('p1', 'send', draft).notes, draft.notes);
});

test('초안 복구는 null과 확인된 0, 재시도 식별자를 그대로 보존한다', () => {
  const draft = createRecordDraft('stock', ID); draft.items[0].quantity = 0;
  const restored = parseRecordDraft(JSON.stringify(draft), 'stock');
  assert.deepEqual(restored, draft);
  assert.equal(restored?.id, ID);
  assert.equal(hasDraftContent(restored!), true);
});

test('손상된 저장 자료와 음수·소수 수량은 초안으로 복구하지 않는다', () => {
  assert.equal(parseRecordDraft('{bad-json', 'stock'), null);
  assert.equal(parseRecordDraft(JSON.stringify({ id: ID, items: [] }), 'stock'), null);
  const draft = createRecordDraft('stock', ID); draft.items[0].quantity = -1;
  assert.equal(parseRecordDraft(JSON.stringify(draft), 'stock'), null);
  draft.items[0].quantity = 1.5; assert.equal(parseRecordDraft(JSON.stringify(draft), 'stock'), null);
});

test('같은 품목과 확정되지 않은 수량으로 잘못된 기록을 만들 수 없다', () => {
  const draft = createRecordDraft('stock', ID);
  assert.throws(() => buildRecordPayload('p1', 'stock', draft, 0));
  draft.items = [{ name: '수건', quantity: 1 }, { name: ' 수건 ', quantity: 2 }];
  assert.match(validateRecordDraft('stock', draft)!, /중복/);
});

test('추가 품목 이름과 자유 입력 비품 원문의 초안을 유지한다', () => {
  const stock = createRecordDraft('stock', ID); stock.items.push({ name: '추가 이불', quantity: null });
  assert.equal(hasDraftContent(stock), true);
  assert.equal(parseRecordDraft(JSON.stringify(stock), 'stock')?.items.at(-1)?.name, '추가 이불');
  const supplies = createRecordDraft('supplies', ID); supplies.requestText = '생수 부족\n휴지 부탁드립니다.';
  assert.equal(hasDraftContent(supplies), true);
  assert.deepEqual(parseRecordDraft(JSON.stringify(supplies), 'supplies')?.items, []);
  assert.equal(parseRecordDraft(JSON.stringify(supplies), 'supplies')?.requestText, supplies.requestText);
});

test('저장 결과가 불명확한 재고 요청은 복구·재조회 후에도 같은 UUID와 기준 버전으로 재시도한다', () => {
  const draft = createRecordDraft('stock', ID); draft.items[0].quantity = 0; draft.baseVersion = 3; draft.attempted = true;
  const original = buildRecordPayload('p1', 'stock', draft, 3);
  const restored = parseRecordDraft(JSON.stringify(draft), 'stock')!;
  assert.equal(restored.attempted, true); assert.equal(restored.baseVersion, 3);
  const retry = buildRecordPayload('p1', 'stock', restored, 7);
  assert.deepEqual(retry, original);
});

test('충돌한 초안은 재검토 필요 상태를 보관하며 잘못된 기준 버전은 복구하지 않는다', () => {
  const draft = createRecordDraft('stock', ID); draft.items[0].quantity = 2; draft.baseVersion = 3; draft.requiresNewReview = true;
  assert.equal(parseRecordDraft(JSON.stringify(draft), 'stock')?.requiresNewReview, true);
  draft.baseVersion = -1; assert.equal(parseRecordDraft(JSON.stringify(draft), 'stock'), null);
});

test('비품 텍스트는 줄바꿈을 유지하고 API와 동일하게 CRLF·앞뒤 공백을 정리한다', () => {
  const draft = createRecordDraft('supplies', ID); draft.requestText = '  생수 부족\r\n휴지 부탁드립니다.  '; draft.urgency = 'urgent';
  assert.deepEqual(buildRecordPayload('p1', 'supplies', draft), { id: ID, propertyId: 'p1', text: '생수 부족\n휴지 부탁드립니다.', urgency: 'urgent' });
  draft.requestText = '가'.repeat(2000); assert.equal(validateRecordDraft('supplies', draft), null);
});

const oldSupplyDraft = (attempted = false) => ({ id: ID, items: [
  { name: '생수', quantity: 6, unit: '팩' }, { name: '휴지', quantity: null, unit: '' }, { name: '쓰레기봉투', quantity: null, unit: '' }, { name: '세제', quantity: null, unit: '' },
], pickupDate: '', deliveryDate: '', vendor: '', vendorPhone: '', notes: '', urgency: 'normal', attempted });

test('기존 비품 초안은 실제 입력한 내용만 텍스트로 변환하고 미확인 수량을 추측하지 않는다', () => {
  const restored = parseRecordDraft(JSON.stringify(oldSupplyDraft()), 'supplies')!;
  assert.equal(restored.id, ID);
  assert.equal(restored.requestText, '생수 6 팩\n세제 (수량 미확인)');
  assert.deepEqual(restored.items, []);
  assert.equal(restored.legacySupplyItems, undefined);
  assert.deepEqual(buildRecordPayload('p1', 'supplies', restored), { id: ID, propertyId: 'p1', text: restored.requestText, urgency: 'normal' });
  const withUnitOnly = oldSupplyDraft(); withUnitOnly.items[0] = { name: '생수', quantity: null, unit: '병' };
  assert.match(parseRecordDraft(JSON.stringify(withUnitOnly), 'supplies')!.requestText, /생수 · 단위: 병 \(수량 미확인\)/);
});

test('이전 방식으로 제출을 시도한 비품 초안은 같은 UUID의 원래 items payload로 재확인한다', () => {
  const restored = parseRecordDraft(JSON.stringify(oldSupplyDraft(true)), 'supplies')!;
  const originalPayload = { id: ID, propertyId: 'p1', items: [{ name: '생수', quantity: 6, unit: '팩' }], urgency: 'normal' };
  assert.equal(restored.attempted, true);
  assert.equal(restored.requestText, '생수 6 팩');
  assert.equal(restored.requestText.includes('세제'), false);
  assert.deepEqual(buildRecordPayload('p1', 'supplies', restored), originalPayload);
  assert.equal('text' in buildRecordPayload('p1', 'supplies', restored), false);
  const restoredAgain = parseRecordDraft(JSON.stringify(restored), 'supplies')!;
  assert.equal(restoredAgain.requestText, '생수 6 팩');
  assert.deepEqual(buildRecordPayload('p1', 'supplies', restoredAgain), originalPayload);
  const oldDisplay = parseRecordDraft(JSON.stringify({ ...restored, requestText: '생수 6 팩\n세제 (수량 미확인)' }), 'supplies')!;
  assert.equal(oldDisplay.requestText, '생수 6 팩');
  assert.deepEqual(buildRecordPayload('p1', 'supplies', oldDisplay), originalPayload);
});

test('새 텍스트 요청의 불명확한 제출 결과도 같은 UUID와 원문으로 재확인한다', () => {
  const draft = createRecordDraft('supplies', ID); draft.requestText = '생수 부족\n수량은 확인 부탁드립니다.'; draft.attempted = true;
  const original = buildRecordPayload('p1', 'supplies', draft);
  const restored = parseRecordDraft(JSON.stringify(draft), 'supplies')!;
  assert.equal(restored.attempted, true);
  assert.equal(restored.legacySupplyItems, undefined);
  assert.deepEqual(buildRecordPayload('p1', 'supplies', restored), original);
});

const oldSendDraft = (attempted = false) => ({ id: ID, items: [{ name: '대형수건', quantity: 5 }, { name: '작은수건', quantity: null }],
  pickupDate: '2026-10-02', deliveryDate: '2026-10-05', vendor: '이전 입력 업체', vendorPhone: '010-1234-5678', notes: '문 앞 전달', urgency: 'normal', attempted });

test('다음날 복구한 제출 시도 상세형 세탁 초안은 원래 UUID·업체·날짜 payload로 재확인한다', context => {
  const saved = JSON.stringify(oldSendDraft(true));
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-09T09:00:00Z') });
  const restored = parseRecordDraft(saved, 'send')!;
  assert.equal(restored.quickSend, false); assert.equal(restored.attempted, true);
  const originalPayload = { id: ID, propertyId: 'p1', pickupDate: '2026-10-02', deliveryDate: '2026-10-05', vendor: '이전 입력 업체', vendorPhone: '010-1234-5678', notes: '문 앞 전달', collected: true,
    items: [{ name: '대형수건', sent: 5, received: 0, damaged: 0, rewash: 0 }] };
  assert.deepEqual(buildRecordPayload('p1', 'send', restored), originalPayload);
  const reopened = parseRecordDraft(JSON.stringify(restored), 'send')!;
  assert.deepEqual(buildRecordPayload('p1', 'send', reopened), originalPayload);
  assert.equal('quickSend' in buildRecordPayload('p1', 'send', reopened), false);
});

test('미제출 상세형 세탁 초안의 메타정보는 버리지 않고 참고 메모로 보존한다', () => {
  const restored = parseRecordDraft(JSON.stringify(oldSendDraft()), 'send')!;
  assert.equal(restored.quickSend, true);
  const payload = buildRecordPayload('p1', 'send', restored);
  assert.ok('quickSend' in payload);
  assert.equal(payload.quickSend, true);
  for (const key of ['pickupDate', 'deliveryDate', 'vendor', 'vendorPhone', 'collected']) assert.equal(key in payload, false);
  assert.match(payload.notes!, /이전 초안 참고 정보 \(일정 확정 아님\)/);
  for (const reference of ['이전 입력 업체', '2026-10-02', '2026-10-05', '010-1234-5678', '문 앞 전달']) assert.ok(payload.notes!.includes(reference));
  assert.equal(restored.vendor, oldSendDraft().vendor);
  const reopened = parseRecordDraft(JSON.stringify(restored), 'send')!;
  assert.deepEqual(buildRecordPayload('p1', 'send', reopened), payload);
});

test('불완전한 이전 세탁 메타정보도 간편 기록으로 남길 수 있고 참고 내용은 잘리지 않는다', () => {
  const partial = oldSendDraft(); partial.pickupDate = ''; partial.deliveryDate = ''; partial.vendorPhone = '';
  const restored = parseRecordDraft(JSON.stringify(partial), 'send')!;
  assert.equal(validateRecordDraft('send', restored), null);
  assert.equal(legacySendReference(restored), '이전 초안 참고 정보 (일정 확정 아님)\n세탁업체 입력값: 이전 입력 업체');
  assert.equal(quickSendNotes(restored), '문 앞 전달\n\n이전 초안 참고 정보 (일정 확정 아님)\n세탁업체 입력값: 이전 입력 업체');
  restored.notes = '가'.repeat(2000);
  assert.match(validateRecordDraft('send', restored)!, /메모와 이전 초안의 참고 정보/);
  assert.equal(restored.notes.length, 2000);
  assert.ok(quickSendNotes(restored).includes('이전 입력 업체'));
  assert.throws(() => buildRecordPayload('p1', 'send', restored));
  const legacy = oldSendDraft(true); legacy.notes = '가'.repeat(2000);
  const pending = parseRecordDraft(JSON.stringify(legacy), 'send')!;
  assert.equal(validateRecordDraft('send', pending), null);
  assert.equal(buildRecordPayload('p1', 'send', pending).notes, legacy.notes);
});

test('간편 세탁 초안도 닫기·다음날 복구 후 같은 UUID와 수량으로 재확인한다', () => {
  const draft = createRecordDraft('send', ID); draft.items[0].quantity = 2; draft.notes = '안쪽 바구니에서 가져갔습니다.'; draft.attempted = true;
  const original = buildRecordPayload('p1', 'send', draft);
  const restored = parseRecordDraft(JSON.stringify(draft), 'send')!;
  assert.equal(restored.quickSend, true); assert.equal(restored.attempted, true);
  assert.deepEqual(buildRecordPayload('p1', 'send', restored), original);
  assert.equal('pickupDate' in original, false);
});
