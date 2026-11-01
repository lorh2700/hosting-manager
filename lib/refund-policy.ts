import { z } from 'zod';
import { refundPolicyTerms, type RefundPolicy } from './refund-policy-display';
export { refundPolicyRows, refundPolicyTerms } from './refund-policy-display';
export type { RefundPolicy, RefundPolicyRow } from './refund-policy-display';

export const refundPolicySchema = z.object({ tiers: z.array(z.object({
  minDaysBefore: z.number().int().min(0).max(3650),
  refundPercent: z.number().int().min(0).max(100),
}).strict()).min(2).max(52) }).strict().refine(policy => policy.tiers[0]?.minDaysBefore === 0
  && policy.tiers.every((tier, index, tiers) => index === 0
    || tier.minDaysBefore > tiers[index - 1].minDaysBefore && tier.refundPercent >= tiers[index - 1].refundPercent),
'환불 구간은 0일부터 오름차순으로 입력하고, 남은 기간이 길수록 환불율이 같거나 높아야 합니다.');

export function readRefundPolicy(value: unknown): RefundPolicy | null {
  return refundPolicySchema.safeParse(value).data ?? null;
}

export function checkoutRefundTerms(value: unknown, fallbackTerms: string): string {
  const policy = readRefundPolicy(value);
  return policy ? `${refundPolicyTerms(policy, 'ko')}\n\n${refundPolicyTerms(policy, 'en')}` : fallbackTerms;
}
