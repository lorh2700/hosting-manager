import { createHash } from 'node:crypto';
import { z } from 'zod';
import { judgeInquiry, verifyInquiry, type InquiryContext } from './inquiry-ai';
import { inquiryFailure, inquiryDatabaseFailure } from './inquiry-ai-error';

const question = z.string().trim().min(1).max(2000);
export const inquiryDiagnosticSchema = z.discriminatedUnion('phase', [
  z.object({ propertyId: z.string().min(1).max(100), phase: z.literal('generate'), question }).strict(),
  z.object({ propertyId: z.string().min(1).max(100), phase: z.literal('verify'), question,
    draft: z.string().trim().min(1).max(3000), knowledgeVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
type Input = z.infer<typeof inquiryDiagnosticSchema>;
type Source = { name: string; knowledge: string; enabled: boolean } | null;

export async function diagnoseInquiry(input: Input, load: (id: string) => Promise<Source>,
  ai = { judge: judgeInquiry, verify: verifyInquiry }) {
  const started = Date.now();
  let stage: 'context' | 'generation' | 'verification' = 'context';
  const base = () => ({ sent: false as const, stage, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
    model: process.env.INQUIRY_AI_MODEL?.trim() || 'gpt-4.1-mini' });
  try {
    const source = await load(input.propertyId);
    if (!source) return { ...base(), status: 'failed' as const, error: { code: 'PROPERTY_NOT_FOUND', message: '숙소를 찾을 수 없습니다.' } };
    if (!source.knowledge.trim()) return { ...base(), status: 'failed' as const, error: { code: 'KNOWLEDGE_EMPTY', message: '자동응답 참고자료를 먼저 저장해 주세요.' } };
    const knowledgeVersion = createHash('sha256').update(JSON.stringify([source.name, source.knowledge])).digest('hex');
    if (input.phase === 'verify' && knowledgeVersion !== input.knowledgeVersion) return { ...base(), status: 'failed' as const,
      error: { code: 'KNOWLEDGE_CHANGED', message: '테스트 중 참고자료가 변경되었습니다. 처음부터 다시 테스트해 주세요.' } };
    const context: InquiryContext = { knowledge: source.knowledge,
      reservation: { property: source.name, checkIn: null, checkOut: null, adults: null, children: null }, messages: [{ sender: 'guest', text: input.question }] };
    stage = input.phase === 'generate' ? 'generation' : 'verification';
    if (input.phase === 'generate') {
      const decision = await ai.judge(context);
      return { ...base(), status: decision.action === 'reply' ? 'passed' as const : 'review' as const, knowledgeVersion,
        automationEnabled: source.enabled, draft: decision.draft, summary: decision.summary, reason: decision.reason, action: decision.action };
    }
    const safe = await ai.verify(context, input.draft);
    return { ...base(), status: safe ? 'passed' as const : 'review' as const,
      reason: safe ? '숙소 안내 자료를 기준으로 답변 검증을 통과했습니다.' : '초안의 근거나 응답 정책을 확인해야 합니다. 자동답변 대상으로 검증되지 않았습니다.' };
  } catch (error) {
    return { ...base(), status: 'failed' as const, error: stage === 'context'
      ? inquiryDatabaseFailure(error)
      : inquiryFailure(error) };
  }
}
