import images from './guide-images.json';

export const guideImages: Record<string, (typeof images)['bukchon']> = {
  tosokchon: images.samgyetang, hwangsaengga: images.kalguksu,
  'london-bagel': images.bagel, cheonha: images.bossam, aehorak: images.korean,
  mijin: images.soba, balwoo: images.temple, 'anchae-tours': images.bukchon,
  'walking-tour': images.bukchon, bukchon: images.bukchon,
  palaces: images.palace, insadong: images.insadong,
};

export type GuideCategory = 'food' | 'tour' | 'place';
type Copy = { ko: string; en: string };
export interface GuideEntry { id: string; category: GuideCategory; name: Copy; tag: Copy; description: Copy; href: string; source: string }
export const RESTAURANT_SOURCE = 'https://excessive-topaz-921.notion.site/Restaurant-Recommendations-1292f782431080dabb2dceb1f5ef98a3';
const hanok = 'https://hanok.seoul.go.kr/front/kor/town/town01.do';
const culture = 'https://korean.visitseoul.net/mvp/서울전통코스_/34902';
export const guideEntries: GuideEntry[] = [
  { id: 'tosokchon', category: 'food', name: { ko: '토속촌', en: 'Tosokchon' }, tag: { ko: '삼계탕', en: 'Ginseng chicken soup' }, description: { ko: '따뜻한 삼계탕으로 든든한 한 끼를 즐기고 싶을 때.', en: 'A warming bowl of traditional Korean ginseng chicken soup.' }, href: 'https://naver.me/FW6hFEuf', source: RESTAURANT_SOURCE },
  { id: 'hwangsaengga', category: 'food', name: { ko: '황생가 칼국수', en: 'Hwangsaengga Kalguksu' }, tag: { ko: '칼국수', en: 'Handmade noodles' }, description: { ko: '진한 국물과 손으로 만든 면을 맛보는 칼국수 식사.', en: 'Handmade noodles served in a rich, comforting broth.' }, href: 'https://naver.me/5Rh0K9Fx', source: RESTAURANT_SOURCE },
  { id: 'london-bagel', category: 'food', name: { ko: '런던 베이글 뮤지엄', en: 'London Bagel Museum' }, tag: { ko: '베이글 · 브런치', en: 'Bagels · Brunch' }, description: { ko: '여러 가지 베이글과 베이커리로 가볍게 즐기는 브런치.', en: 'Bagels and baked goods for a casual brunch.' }, href: 'https://naver.me/xNLZDTek', source: RESTAURANT_SOURCE },
  { id: 'cheonha', category: 'food', name: { ko: '천하보쌈', en: 'Cheonha Bossam' }, tag: { ko: '보쌈', en: 'Bossam' }, description: { ko: '삶은 돼지고기와 김치를 함께 즐기는 한식 한 상.', en: 'Korean boiled pork paired with kimchi for a hearty meal.' }, href: 'https://naver.me/5vcHJFZf', source: RESTAURANT_SOURCE },
  { id: 'aehorak', category: 'food', name: { ko: '애호락', en: 'Ae Horak' }, tag: { ko: '한식', en: 'Korean dining' }, description: { ko: '정갈하게 차려낸 계절 요리를 즐기는 한식 식사.', en: 'Thoughtfully presented Korean dishes with seasonal ingredients.' }, href: 'https://naver.me/xrSQBZ0r', source: RESTAURANT_SOURCE },
  { id: 'mijin', category: 'food', name: { ko: '광화문 미진', en: 'Gwanghwamun Mijin' }, tag: { ko: '메밀국수', en: 'Buckwheat noodles' }, description: { ko: '시원한 메밀국수로 가볍고 산뜻하게 즐기는 한 끼.', en: 'Cold buckwheat noodles for a light, refreshing meal.' }, href: 'https://naver.me/5mI0aN2M', source: RESTAURANT_SOURCE },
  { id: 'balwoo', category: 'food', name: { ko: '발우공양', en: 'Balwoo Gongyang' }, tag: { ko: '사찰음식', en: 'Temple cuisine' }, description: { ko: '계절 식재료를 중심으로 한국 사찰음식을 경험하는 곳.', en: 'Discover Korean temple cuisine built around seasonal ingredients.' }, href: 'https://naver.me/Fr7palKq', source: RESTAURANT_SOURCE },
  { id: 'anchae-tours', category: 'tour', name: { ko: '안채 투어 · 체험', en: 'Anchae tours & experiences' }, tag: { ko: '예약문의', en: 'Booking inquiry' }, description: { ko: '투어와 체험의 희망 일정을 문의하세요. 예약 가능 여부와 최종 확정은 메시지로 안내드립니다.', en: 'Request your preferred date and time. Availability and final confirmation will be sent by message.' }, href: '/tours', source: '/tours' },
  { id: 'walking-tour', category: 'tour', name: { ko: '서울도보해설관광', en: 'Seoul guided walking tours' }, tag: { ko: '문화관광해설사 동행', en: 'Guided cultural walk' }, description: { ko: '북촌 한옥마을 등 서울의 명소를 해설사와 함께 걷는 프로그램. 공식 사이트에서 코스와 예약을 확인하세요.', en: 'Explore routes including Bukchon Hanok Village with a cultural guide. Check the official site for reservations.' }, href: 'https://dobo.visitseoul.net/main/index', source: 'https://dobo.visitseoul.net/main/index' },
  { id: 'bukchon', category: 'place', name: { ko: '북촌 한옥마을', en: 'Bukchon Hanok Village' }, tag: { ko: '한옥 · 골목 산책', en: 'Hanok · Neighborhood walks' }, description: { ko: '경복궁과 창덕궁 사이, 한옥과 주민의 일상이 이어지는 동네를 천천히 둘러보세요.', en: 'Discover a living hanok neighborhood between Gyeongbokgung and Changdeokgung palaces.' }, href: hanok, source: hanok },
  { id: 'palaces', category: 'place', name: { ko: '경복궁 · 창덕궁', en: 'Gyeongbokgung & Changdeokgung' }, tag: { ko: '궁궐 · 전통문화', en: 'Palaces · Heritage' }, description: { ko: '북촌 여행에 궁궐 관람을 더해 보세요. 궁별 관람 및 예매 안내를 확인하고 일정을 정하세요.', en: 'Pair your Bukchon visit with a palace. Check admission and booking details before planning your day.' }, href: culture, source: culture },
  { id: 'insadong', category: 'place', name: { ko: '인사동', en: 'Insadong' }, tag: { ko: '전통문화 산책', en: 'Traditional culture' }, description: { ko: '북촌과 함께 둘러볼 수 있는 전통문화 여행지. 서울관광 안내에서 주변 코스를 살펴보세요.', en: 'Add Insadong to your cultural itinerary around Bukchon. Explore the official Seoul itinerary for ideas.' }, href: culture, source: culture },
];
