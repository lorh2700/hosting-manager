/**
 * 게스트 대화에서 정비에 중요한 신호를 뽑는다: 얼리 체크인 문의, 레이트 체크아웃 문의, 요청사항.
 * 키워드 규칙이라 놓칠 수 있으니 태그는 "확인하라"는 힌트이고, 대화 자체를 카드에 같이 보여준다.
 */
export type GuestFlag = 'early_checkin' | 'late_checkout' | 'request';

export const GUEST_FLAG_LABEL: Record<GuestFlag, string> = {
  early_checkin: '얼리 체크인 문의',
  late_checkout: '레이트 체크아웃 문의',
  request: '요청사항',
};

const RULES: { flag: GuestFlag; re: RegExp }[] = [
  {
    flag: 'early_checkin',
    re: /얼리\s*체크인|일찍\s*(체크인|들어|입실)|이른\s*(체크인|입실)|early\s*check[- ]?in|check[- ]?in\s*(early|earlier|before)|arrive\s*(early|earlier|before)|짐(을|만)?\s*(맡|보관|두)|luggage|baggage|bag(s)?\s*(drop|store|leave|keep)|drop\s*(off\s*)?(our|my|the)?\s*(bags?|luggage)|アーリー|早め.*チェックイン|荷物.*(預|置)|提前.*入住|寄存/i,
  },
  {
    flag: 'late_checkout',
    re: /레이트\s*체크아웃|늦(게|은)\s*(체크아웃|퇴실)|체크아웃.*(늦|연장|미룰|미뤄)|late\s*check[- ]?out|check[- ]?out\s*(late|later|at\s*1[2-9]|at\s*noon)|extend.*(stay|check[- ]?out)|レイト|遅め.*チェックアウト|延長|延迟.*退房|晚.*退房/i,
  },
  {
    flag: 'request',
    re: /요청|부탁|가능할까요|가능한가요|있을까요|될까요|괜찮을까요|알레르기|allerg|birthday|생일|anniversary|기념일|honeymoon|신혼|baby|아기|유아|infant|crib|toddler|extra\s*bed|추가\s*침대|bedding|이불|vegetarian|vegan|채식|halal|wheelchair|휠체어|parking|주차|\bpet\b|반려|강아지|고양이|surprise|flowers|꽃|cake|케이크|taxi|택시|pickup|픽업|smok|흡연|quiet|조용|noise|소음/i,
  },
];

/** 게스트가 보낸 메시지 본문들에서 태그를 뽑는다 (중복 없이, 규칙 순서대로). */
export function detectGuestFlags(texts: string[]): GuestFlag[] {
  const joined = texts.filter(Boolean).join('\n');
  if (!joined.trim()) return [];
  return RULES.filter(r => r.re.test(joined)).map(r => r.flag);
}

/** 투숙 박 수 (YYYY-MM-DD 문자열 두 개) */
export function nightsBetween(start: string, end: string): number {
  const a = Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)));
  const b = Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, Number(end.slice(8, 10)));
  return Math.max(0, Math.round((b - a) / 86_400_000));
}
