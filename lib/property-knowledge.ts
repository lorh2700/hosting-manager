/**
 * Property Knowledge Base for AI Auto-Reply
 *
 * 각 숙소의 기본 정보, 이용 안내, 주변 관광지 등을 구조화하여
 * AI가 게스트 질문에 정확하게 답변할 수 있도록 합니다.
 */

export interface PropertyKnowledge {
  id: string;
  beds24PropId?: string;     // Beds24 property ID
  name: { ko: string; en: string };
  address: { ko: string; en: string };
  doorLockPassword: string;
  checkIn: string;
  checkOut: string;
  maxGuests: number;
  directions: {
    subway: string;
    taxi: string;
    taxiKorean: string;      // 택시기사에게 보여줄 한국어 주소
  };
  wifi?: { ssid: string; password: string };
  houseRules: string[];
  nearbyAttractions: { name: string; distance: string; description: string }[];
  extras: string[];          // 기타 안내사항
}

/**
 * 숙소별 지식 베이스
 * ⚠️ 비밀번호 등 민감 정보 포함 — 환경변수로 분리하거나 DB에서 가져오는 것을 추후 고려
 */
export const PROPERTY_KNOWLEDGE: PropertyKnowledge[] = [
  {
    id: 'hwayeonjae',
    name: { ko: '화연재', en: 'Hwayeonjae' },
    address: {
      ko: '서울 종로구 북촌로5나길 11',
      en: '11, Bukchon-ro 5na-gil, Jongno-gu, Seoul',
    },
    doorLockPassword: '*4579*',
    checkIn: '3:00 PM',
    checkOut: '11:00 AM',
    maxGuests: 4,
    directions: {
      subway: 'Anguk Station (Line 3), Exit 2 — about 10 min walk',
      taxi: 'Show the driver the Korean address below',
      taxiKorean: '종로구 북촌로5나길 11',
    },
    houseRules: [
      'Please remove your shoes when entering the hanok',
      'Keep noise to a minimum, especially after 10:00 PM (quiet residential area)',
      'No smoking inside the hanok',
      'Please close all windows and doors when you leave',
    ],
    nearbyAttractions: [
      { name: 'Bukchon Hanok Village', distance: 'right outside', description: 'Traditional Korean village with beautiful hanok houses' },
      { name: 'Gyeongbokgung Palace', distance: '10 min walk', description: 'The main royal palace of the Joseon dynasty' },
      { name: 'Samcheong-dong', distance: '5 min walk', description: 'Trendy area with cafes, galleries and boutiques' },
      { name: 'Insadong', distance: '10 min walk', description: 'Traditional street with Korean crafts, tea houses and antiques' },
      { name: 'Changdeokgung Palace', distance: '10 min walk', description: 'UNESCO World Heritage palace with beautiful Secret Garden' },
      { name: 'Gwangjang Market', distance: '15 min walk', description: 'Famous traditional market for Korean street food (bindaetteok, mayak gimbap)' },
    ],
    extras: [
      'The hanok is a traditional Korean house — floors are heated (ondol system)',
      'Bedding is Korean-style (yo/mattress on the floor)',
      'There is no elevator — the hanok is on a hilly area',
    ],
  },
  {
    id: 'unwadang',
    name: { ko: '운와당', en: 'Unwadang' },
    address: {
      ko: '서울 종로구 북촌로11나길 16-20',
      en: '16-20, Bukchon-ro 11na-gil, Jongno-gu, Seoul',
    },
    doorLockPassword: '6527*',
    checkIn: '3:00 PM',
    checkOut: '11:00 AM',
    maxGuests: 4,
    directions: {
      subway: 'Anguk Station (Line 3), Exit 2 — about 10 min walk',
      taxi: 'Show the driver the Korean address below',
      taxiKorean: '종로구 북촌로11나길 16-20',
    },
    houseRules: [
      'Please remove your shoes when entering the hanok',
      'Keep noise to a minimum, especially after 10:00 PM (quiet residential area)',
      'No smoking inside the hanok',
      'Please close all windows and doors when you leave',
    ],
    nearbyAttractions: [
      { name: 'Bukchon Hanok Village', distance: 'right outside', description: 'Traditional Korean village with beautiful hanok houses' },
      { name: 'Gyeongbokgung Palace', distance: '10 min walk', description: 'The main royal palace of the Joseon dynasty' },
      { name: 'Samcheong-dong', distance: '5 min walk', description: 'Trendy area with cafes, galleries and boutiques' },
      { name: 'Insadong', distance: '10 min walk', description: 'Traditional street with Korean crafts, tea houses and antiques' },
      { name: 'Changdeokgung Palace', distance: '10 min walk', description: 'UNESCO World Heritage palace with beautiful Secret Garden' },
      { name: 'Gwangjang Market', distance: '15 min walk', description: 'Famous traditional market for Korean street food (bindaetteok, mayak gimbap)' },
    ],
    extras: [
      'The hanok is a traditional Korean house — floors are heated (ondol system)',
      'Bedding is Korean-style (yo/mattress on the floor)',
      'There is no elevator — the hanok is on a hilly area',
    ],
  },
  {
    id: 'anonaje',
    name: { ko: '안온재', en: 'Anonaje' },
    address: {
      ko: '서울 종로구 삼청로2길 21-4',
      en: '21-4, Samcheong-ro 2-gil, Jongno-gu, Seoul',
    },
    doorLockPassword: '2421*',
    checkIn: '3:00 PM',
    checkOut: '11:00 AM',
    maxGuests: 2,
    directions: {
      subway: 'Anguk Station (Line 3), Exit 1 — about 8 min walk',
      taxi: 'Show the driver the Korean address below',
      taxiKorean: '종로구 삼청로2길 21-4',
    },
    houseRules: [
      'Please remove your shoes when entering the hanok',
      'Keep noise to a minimum, especially after 10:00 PM (quiet residential area)',
      'No smoking inside the hanok',
      'Please close all windows and doors when you leave',
    ],
    nearbyAttractions: [
      { name: 'Samcheong-dong', distance: 'right outside', description: 'Trendy area with cafes, galleries and boutiques' },
      { name: 'Gyeongbokgung Palace', distance: '5 min walk', description: 'The main royal palace of the Joseon dynasty' },
      { name: 'National Folk Museum', distance: '5 min walk', description: 'Museum of Korean folk culture inside Gyeongbokgung grounds' },
      { name: 'Bukchon Hanok Village', distance: '10 min walk', description: 'Traditional Korean village with beautiful hanok houses' },
      { name: 'Insadong', distance: '10 min walk', description: 'Traditional street with Korean crafts, tea houses and antiques' },
      { name: 'Changdeokgung Palace', distance: '15 min walk', description: 'UNESCO World Heritage palace with beautiful Secret Garden' },
    ],
    extras: [
      'The hanok is a traditional Korean house — floors are heated (ondol system)',
      'Bedding is Korean-style (yo/mattress on the floor)',
      'Anonaje is a cozy space designed for 2 guests maximum',
    ],
  },
  {
    id: 'dowonjae',
    name: { ko: '도원재', en: 'Dowonjae' },
    address: {
      ko: '서울 종로구 북촌한옥마을 인근',
      en: 'Near Bukchon Hanok Village, Jongno-gu, Seoul',
    },
    doorLockPassword: '',  // 관리자가 채워야 함
    checkIn: '3:00 PM',
    checkOut: '11:00 AM',
    maxGuests: 4,
    directions: {
      subway: 'Anguk Station (Line 3), Exit 2 — about 10 min walk',
      taxi: 'Show the driver the Korean address below',
      taxiKorean: '종로구 북촌한옥마을',
    },
    houseRules: [
      'Please remove your shoes when entering the hanok',
      'Keep noise to a minimum, especially after 10:00 PM (quiet residential area)',
      'No smoking inside the hanok',
      'Please close all windows and doors when you leave',
    ],
    nearbyAttractions: [
      { name: 'Bukchon Hanok Village', distance: 'right outside', description: 'Traditional Korean village with beautiful hanok houses' },
      { name: 'Gyeongbokgung Palace', distance: '10 min walk', description: 'The main royal palace of the Joseon dynasty' },
      { name: 'Samcheong-dong', distance: '5 min walk', description: 'Trendy area with cafes, galleries and boutiques' },
      { name: 'Insadong', distance: '10 min walk', description: 'Traditional street with Korean crafts, tea houses and antiques' },
    ],
    extras: [
      'The hanok is a traditional Korean house — floors are heated (ondol system)',
      'Bedding is Korean-style (yo/mattress on the floor)',
    ],
  },
  {
    id: 'byeolha',
    name: { ko: '별하재', en: 'Byeolhajae' },
    address: {
      ko: '서울 종로구 북촌로5나길 7-4',
      en: '7-4, Bukchon-ro 5na-gil, Jongno-gu, Seoul',
    },
    doorLockPassword: '',  // 관리자가 채워야 함
    checkIn: '3:00 PM',
    checkOut: '11:00 AM',
    maxGuests: 6,
    directions: {
      subway: 'Anguk Station (Line 3), Exit 2 — about 10 min walk',
      taxi: 'Show the driver the Korean address below',
      taxiKorean: '종로구 북촌로5나길 7-4',
    },
    houseRules: [
      'Please remove your shoes when entering the hanok',
      'Keep noise to a minimum, especially after 10:00 PM (quiet residential area)',
      'No smoking inside the hanok',
      'Please close all windows and doors when you leave',
    ],
    nearbyAttractions: [
      { name: 'Bukchon Hanok Village', distance: 'right outside', description: 'Traditional Korean village with beautiful hanok houses' },
      { name: 'Gyeongbokgung Palace', distance: '10 min walk', description: 'The main royal palace of the Joseon dynasty' },
      { name: 'Samcheong-dong', distance: '5 min walk', description: 'Trendy area with cafes, galleries and boutiques' },
      { name: 'Insadong', distance: '10 min walk', description: 'Traditional street with Korean crafts, tea houses and antiques' },
      { name: 'Changdeokgung Palace', distance: '10 min walk', description: 'UNESCO World Heritage palace with beautiful Secret Garden' },
    ],
    extras: [
      'The hanok is a traditional Korean house — floors are heated (ondol system)',
      'Bedding is Korean-style (yo/mattress on the floor)',
      'Byeolhajae accommodates up to 6 guests — spacious for families or small groups',
    ],
  },
  {
    id: 'jarakheon',
    name: { ko: '자락헌', en: 'Jarakheon' },
    address: {
      ko: '서울 종로구 북촌로15길 37',
      en: '37, Bukchon-ro 15-gil, Jongno-gu, Seoul',
    },
    doorLockPassword: '',  // 오픈 전 미정
    checkIn: '3:00 PM',
    checkOut: '11:00 AM',
    maxGuests: 4,
    directions: {
      subway: 'Anguk Station (Line 3), Exit 2 — about 12 min walk',
      taxi: 'Show the driver the Korean address below',
      taxiKorean: '종로구 북촌로15길 37',
    },
    houseRules: [
      'Please remove your shoes when entering the hanok',
      'Keep noise to a minimum, especially after 10:00 PM (quiet residential area)',
      'No smoking inside the hanok',
      'Please close all windows and doors when you leave',
    ],
    nearbyAttractions: [
      { name: 'Bukchon Hanok Village', distance: 'right outside', description: 'Traditional Korean village with beautiful hanok houses' },
      { name: 'Gyeongbokgung Palace', distance: '10 min walk', description: 'The main royal palace of the Joseon dynasty' },
      { name: 'Samcheong-dong', distance: '5 min walk', description: 'Trendy area with cafes, galleries and boutiques' },
    ],
    extras: [
      'Opening October 2026 — details will be finalized closer to launch',
      'The hanok is a traditional Korean house — floors are heated (ondol system)',
      'Bedding is Korean-style (yo/mattress on the floor)',
    ],
  },
];

/**
 * Beds24 property ID로 숙소 정보를 찾습니다.
 */
export function findPropertyByBeds24Id(beds24PropId: string): PropertyKnowledge | undefined {
  return PROPERTY_KNOWLEDGE.find(p => p.beds24PropId === beds24PropId);
}

/**
 * 내부 property ID로 숙소 정보를 찾습니다.
 */
export function findPropertyById(id: string): PropertyKnowledge | undefined {
  return PROPERTY_KNOWLEDGE.find(p => p.id === id);
}

/**
 * 숙소 정보를 AI 시스템 프롬프트용 텍스트로 변환합니다.
 */
export function propertyToContext(property: PropertyKnowledge): string {
  const attractions = property.nearbyAttractions
    .map(a => `  - ${a.name} (${a.distance}): ${a.description}`)
    .join('\n');

  const rules = property.houseRules.map(r => `  - ${r}`).join('\n');
  const extras = property.extras.map(e => `  - ${e}`).join('\n');

  return `
=== Property: ${property.name.en} (${property.name.ko}) ===

Address: ${property.address.en}
Korean address (for taxi): ${property.directions.taxiKorean}
Check-in: ${property.checkIn}
Check-out: ${property.checkOut}
Max guests: ${property.maxGuests}
Door lock password: ${property.doorLockPassword}

How to get here:
  - Subway: ${property.directions.subway}
  - Taxi: ${property.directions.taxi}

House rules:
${rules}

Nearby attractions & restaurants:
${attractions}

Additional info:
${extras}
`.trim();
}
