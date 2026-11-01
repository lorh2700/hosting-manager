export interface RefundPolicy {
  tiers: Array<{ minDaysBefore: number; refundPercent: number }>;
}

export interface RefundPolicyRow {
  minDaysBefore: number;
  maxDaysBefore: number | null;
  refundPercent: number;
  label: string;
}

export function refundPolicyRows(policy: RefundPolicy, language: 'ko' | 'en' = 'ko'): RefundPolicyRow[] {
  return policy.tiers.map((tier, index, tiers) => {
    const maxDaysBefore = tiers[index + 1] ? tiers[index + 1].minDaysBefore - 1 : null;
    const min = tier.minDaysBefore;
    let label: string;
    if (language === 'en') {
      label = maxDaysBefore === null ? `${min} or more days before check-in`
        : maxDaysBefore === 0 ? 'Check-in day'
          : min === 0 ? `Within ${maxDaysBefore} day${maxDaysBefore === 1 ? '' : 's'} before check-in`
            : min === maxDaysBefore ? `${min} day${min === 1 ? '' : 's'} before check-in`
              : `${min}–${maxDaysBefore} days before check-in`;
    } else {
      label = maxDaysBefore === null ? `${min}일 이상 전`
        : maxDaysBefore === 0 ? '체크인 당일'
          : min === 0 ? `${maxDaysBefore}일 이내`
            : min === maxDaysBefore ? `${min}일 전` : `${min}~${maxDaysBefore}일 전`;
    }
    return { ...tier, maxDaysBefore, label };
  }).reverse();
}

export function refundPolicyTerms(policy: RefundPolicy, language: 'ko' | 'en' = 'ko'): string {
  const heading = language === 'en' ? 'Cancellation and refund policy (relative to check-in)' : '취소·환불 규정 (체크인 기준)';
  const rows = refundPolicyRows(policy, language).map(row => `${row.label}: ${language === 'en'
    ? row.refundPercent === 0 ? 'Non-refundable (0%)' : `${row.refundPercent}% refund`
    : row.refundPercent === 0 ? '환불 불가 (0%)' : `${row.refundPercent}% 환불`}`);
  return [heading, ...rows].join('\n');
}
