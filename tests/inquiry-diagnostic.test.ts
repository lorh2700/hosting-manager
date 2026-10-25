import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseInquiry } from '../lib/inquiry-diagnostic';
import { InquiryAiError, inquiryFailure, providerFailure, inquiryDatabaseFailure } from '../lib/inquiry-ai-error';
import { POST } from '../app/api/internal/inquiry-diagnostic/route';
import { db, calls, resetDb } from './stubs/prisma';
import { fetchLog, resetFetch, setFetchHandler, json, callRoute } from './helpers/beds24-mock';

const source = { name: '테스트 숙소', knowledge: '체크인은 오후 3시입니다.', enabled: false };
const input = { propertyId: 'p1', phase: 'generate' as const, question: '체크인 시간?' };
const answer = { action: 'reply' as const, category: 'checkin' as const, draft: '오후 3시부터입니다.', summary: '시간 문의', reason: '자료에 명시', evidence: ['체크인은 오후 3시입니다.'] };
beforeEach(() => { resetDb(); resetFetch(); process.env.BACKEND_BRIDGE_SECRET = 'test-bridge-secret'.repeat(3); process.env.OPENAI_API_KEY = 'test-key'; });

test('disabled automation can generate and verify without any reservation assumptions or side effects', async () => {
  const ai = { judge: async (context: any) => { assert.equal(context.reservation.checkIn, null); return answer; }, verify: async () => true };
  const first = await diagnoseInquiry(input, async () => source, ai);
  assert.equal(first.sent, false); assert.equal(first.status, 'passed'); assert.equal(first.stage, 'generation');
  assert.ok('knowledgeVersion' in first);
  const second = await diagnoseInquiry({ ...input, phase: 'verify', draft: answer.draft, knowledgeVersion: first.knowledgeVersion! }, async () => source, ai);
  assert.equal(second.status, 'passed'); assert.equal(second.stage, 'verification');
  assert.equal(calls.length, 0); assert.equal(fetchLog.length, 0);
});

test('missing or changed knowledge, review decisions, DB errors and verification failures stay distinct', async () => {
  let aiCalls = 0;
  const ai = { judge: async () => { aiCalls++; return { ...answer, action: 'escalate' as const }; }, verify: async () => { aiCalls++; return false; } };
  assert.equal((await diagnoseInquiry(input, async () => ({ ...source, knowledge: '' }), ai)).status, 'failed');
  const unavailable = await diagnoseInquiry(input, async () => { throw Error('postgres://password@host'); }, ai);
  assert.equal(unavailable.stage, 'context'); assert.ok(!JSON.stringify(unavailable).includes('password'));
  const changed = await diagnoseInquiry({ ...input, phase: 'verify', draft: answer.draft, knowledgeVersion: 'a'.repeat(64) }, async () => source, ai);
  assert.equal(changed.status, 'failed'); assert.equal(aiCalls, 0);
  const review = await diagnoseInquiry(input, async () => source, ai);
  assert.equal(review.status, 'review'); assert.equal(review.stage, 'generation');
  const first = await diagnoseInquiry(input, async () => source, { ...ai, judge: async () => answer });
  assert.ok('knowledgeVersion' in first);
  const verification = await diagnoseInquiry({ ...input, phase: 'verify', draft: answer.draft, knowledgeVersion: first.knowledgeVersion! }, async () => source, ai);
  assert.equal(verification.status, 'review'); assert.equal(verification.stage, 'verification');
  const failed = await diagnoseInquiry({ ...input, phase: 'verify', draft: answer.draft, knowledgeVersion: first.knowledgeVersion! }, async () => source, { ...ai, verify: async () => { throw new InquiryAiError('AI_TIMEOUT'); } });
  assert.equal(failed.status, 'failed'); assert.equal(failed.stage, 'verification');
});

test('provider diagnostics allow only known error codes and never raw provider messages', () => {
  for (const [status, code] of [[401, 'invalid_api_key'], [429, 'rate_limit_exceeded'], [429, 'insufficient_quota'], [429, 'project_spend_limit_exceeded'], [404, 'model_not_found']] as const) {
    const result = inquiryFailure(providerFailure(status, { error: { code, message: 'secret-guest-api-key' } }));
    assert.equal(result.code, code); assert.equal(result.httpStatus, status); assert.ok(!JSON.stringify(result).includes('secret-guest'));
  }
  assert.equal(inquiryFailure(providerFailure(400, { error: { code: 'secret-api-key' } })).code, 'AI_HTTP_400');
  assert.equal(inquiryDatabaseFailure(new Error('Connection terminated due to connection timeout')).code, 'DATABASE_TIMEOUT');
  assert.equal(inquiryDatabaseFailure({ cause: { code: 'P2021', message: 'secret-table-value' } }).code, 'DATABASE_SCHEMA_MISSING');
  assert.equal(inquiryDatabaseFailure({ cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } }).code, 'DATABASE_TLS_FAILED');
});

test('internal endpoint rejects absent auth and invalid input, then uses only reads and OpenAI', async () => {
  const request = (key: string, body: unknown) => new Request('https://example.com/api/internal/inquiry-diagnostic', { method: 'POST', headers: { 'content-type': 'application/json', 'x-backend-key': key }, body: JSON.stringify(body) });
  assert.equal((await callRoute(POST, request('', input))).status, 401);
  assert.equal((await callRoute(POST, request(process.env.BACKEND_BRIDGE_SECRET!, { ...input, send: true }))).status, 400);
  assert.equal(calls.length, 0);
  db.property = [{ id: 'p1', name: source.name }]; db.inquiryAutomationSettings = [{ propertyId: 'p1', ...source }];
  const before = JSON.stringify(db);
  setFetchHandler(() => json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] }));
  const result = await callRoute(POST, request(process.env.BACKEND_BRIDGE_SECRET!, input));
  assert.equal(result.status, 200); assert.equal(result.body.sent, false); assert.equal(result.body.draft, answer.draft);
  assert.equal(JSON.stringify(db), before); assert.deepEqual(calls.filter(call => !call.startsWith('POST ')), ['property.findUnique', 'inquiryAutomationSettings.findUnique']);
  assert.equal(fetchLog.length, 1); assert.ok(String(fetchLog[0].url).startsWith('https://api.openai.com/'));
});
