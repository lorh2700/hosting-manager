import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { judgeCheckoutSnapshot, DEFAULT_VISION_MODEL } from '../lib/checkout-vision';
import { isLeavingWithLuggage } from '../lib/camera-types';

const oldKey = process.env.OPENAI_API_KEY;
const oldModel = process.env.CHECKOUT_VISION_MODEL;
const input = {
  propertyName: '별하재', cameraNotes: '왼쪽이 현관',
  images: [{ buffer: new ArrayBuffer(8), contentType: 'image/jpeg', capturedAt: new Date('2026-09-12T02:00:00Z') }],
};
const verdict = { people_present: true, person_count: 2, luggage: 'suitcase_or_large_bag', direction: 'toward_exit', likely_role: 'guest', confidence: 0.9, summary_ko: '캐리어를 들고 현관으로 이동' };
const response = (text = JSON.stringify(verdict)) => ({
  status: 'completed', model: 'gpt-4.1-mini-2025-04-14',
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
});

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.CHECKOUT_VISION_MODEL;
});
afterEach(() => {
  mock.restoreAll();
  if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
  if (oldModel === undefined) delete process.env.CHECKOUT_VISION_MODEL; else process.env.CHECKOUT_VISION_MODEL = oldModel;
});

test('OpenAI에 최대 6장의 이미지와 구조화 스키마를 보내고 기존 판정 형식을 유지한다', async () => {
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-openai-key');
    assert.ok(init.signal);
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, DEFAULT_VISION_MODEL);
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.ok(body.text.format.schema.required.includes('confidence'));
    const images = body.input[0].content.filter((c: { type: string }) => c.type === 'input_image');
    assert.equal(images.length, 6);
    assert.match(images[0].image_url, /^data:image\/jpeg;base64,/);
    assert.match(JSON.stringify(body.input), /왼쪽이 현관/);
    return Response.json(response());
  });
  const result = await judgeCheckoutSnapshot({ ...input, images: Array(7).fill(input.images[0]) });
  assert.ok(result);
  assert.equal(result.personCount, 2);
  assert.equal(result.summary, verdict.summary_ko);
  assert.equal(result.model, 'gpt-4.1-mini-2025-04-14');
  assert.ok(isLeavingWithLuggage(result));
});

test('키 미설정 또는 사진 없음이면 API를 호출하지 않는다', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request'); });
  assert.equal(await judgeCheckoutSnapshot({ ...input, images: [] }), null);
  process.env.OPENAI_API_KEY = ' ';
  assert.equal(await judgeCheckoutSnapshot(input), null);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('남아 있는 Claude 모델 설정을 대체하고 GPT 모델 지정은 유지한다', async () => {
  const models: string[] = [];
  mock.method(globalThis, 'fetch', async (_: string, init: RequestInit) => {
    models.push(JSON.parse(String(init.body)).model);
    return Response.json(response());
  });
  process.env.CHECKOUT_VISION_MODEL = 'claude-opus-5';
  await judgeCheckoutSnapshot(input);
  process.env.CHECKOUT_VISION_MODEL = ' gpt-4.1 ';
  await judgeCheckoutSnapshot(input);
  assert.deepEqual(models, [DEFAULT_VISION_MODEL, 'gpt-4.1']);
});

test('거부·불완전·잘못된 JSON·잘못된 필드는 판정 없음으로 처리한다', async () => {
  const payloads = [
    { ...response(), output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'declined' }] }] },
    { ...response(), status: 'incomplete' },
    { ...response(), output: [] },
    response('not json'),
    response(JSON.stringify({ ...verdict, confidence: 'high' })),
  ];
  mock.method(globalThis, 'fetch', async () => Response.json(payloads.shift()));
  for (let i = 0; i < 5; i++) assert.equal(await judgeCheckoutSnapshot(input), null);
});

test('인증·한도 오류와 네트워크/시간 초과는 재호출 없이 판정 없음으로 처리한다', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    const call = fetchMock.mock.callCount();
    if (call === 1) return new Response('', { status: 401 });
    if (call === 2) return new Response('', { status: 429 });
    throw new DOMException('Timeout', 'TimeoutError');
  });
  for (let i = 0; i < 3; i++) assert.equal(await judgeCheckoutSnapshot(input), null);
  assert.equal(fetchMock.mock.callCount(), 3);
});
