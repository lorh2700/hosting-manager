// 공개 페이지에 노출되는 지점별 표시 메타. DB Property 는 관리·예약 데이터를
// 다루고, 사진/캐치프레이즈/이미지 폴더 매핑 같은 화면용 정보는 여기서 코드로 관리.
//
// slug 는 DB Property.slug 와 1:1.

export type PropertyDisplay = {
  slug: string;
  name: string;              // 표시명
  region: string;            // '북촌', '삼청동' 등 지역 소분류
  catchphrase: string;       // 홈 카드 하단 한 줄 소개
  imageFolder: string;       // public/images/{imageFolder}/*
  imageFiles: string[];      // 파일명 (확장자 제외). jpg + webp 세트 로드.
  checkInTime: string;       // '15:00'
  checkOutTime: string;      // '11:00'
  addressKo: string;         // 주소 (한글, 상세)
  // 홈 카드 노출용 상태 힌트. DB Property.status 가 source of truth 이지만
  // 홈페이지가 SSG/SSR 무관하게 즉시 렌더할 수 있도록 여기에도 유지.
  // DB 와 항상 동기화 유지 필요.
  status: 'active' | 'coming_soon' | 'closed';
  openingLabel?: string;     // 'coming_soon' 일 때 카드에 표시 (예: '10월 오픈 예정')
};

// public/images/{folder}/{file}.jpg + .webp 형식으로 저장돼 있어야 함.
// 첫 번째 이미지가 홈 카드 대표 사진.
export const PROPERTY_DISPLAY: Record<string, PropertyDisplay> = {
  anon: {
    slug: 'anon',
    name: '안온재',
    region: '북촌',
    catchphrase: '한적한 골목의 아늑함',
    imageFolder: 'anon',
    imageFiles: ['anon_main', 'DSC09279', 'DSC09295', 'DSC09301', 'DSC09310', 'DSC09386', 'main'],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    addressKo: '서울 종로구 북촌한옥마을 인근',
    status: 'active',
  },
  unwadang: {
    slug: 'unwadang',
    name: '운와당',
    region: '북촌',
    catchphrase: '구름이 머무는 마당',
    imageFolder: 'unwa',
    imageFiles: ['main', 'DSC07919', 'DSC08173', 'DSC08643', 'DSC08753', 'KakaoTalk_20240923_163616948', 'KakaoTalk_20241002_124006106_01'],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    addressKo: '서울 종로구 북촌로11나길 16-20',
    status: 'active',
  },
  hwayeonjae: {
    slug: 'hwayeonjae',
    name: '화연재',
    region: '북촌',
    catchphrase: '꽃과 인연을 나누는 자리',
    imageFolder: 'hwayeon',
    imageFiles: ['main', 'DSC04187', 'DSC04190', 'DSC04192', 'DSC04236', 'DSC04238', 'hwayeon_after'],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    addressKo: '서울 종로구 북촌한옥마을 인근',
    status: 'active',
  },
  dowonjae: {
    slug: 'dowonjae',
    name: '도원재',
    region: '북촌',
    catchphrase: '무릉도원 같은 하루',
    imageFolder: 'dowon',
    imageFiles: ['main', 'KakaoTalk_20250716_110016098_07'],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    addressKo: '서울 종로구 북촌한옥마을 인근',
    status: 'active',
  },
  byeolha: {
    slug: 'byeolha',
    name: '별하재',
    region: '북촌',
    catchphrase: '별빛 아래 머무는 밤',
    imageFolder: 'byeolha',
    imageFiles: [],  // 사진 준비 후 채움
    checkInTime: '15:00',
    checkOutTime: '11:00',
    addressKo: '서울 종로구 북촌로5나길 7-4',
    status: 'active',
  },
  jarakheon: {
    slug: 'jarakheon',
    name: '자락헌',
    region: '북촌',
    catchphrase: '자락에 앉은 한옥',
    imageFolder: 'jarakheon',
    imageFiles: [],  // 오픈 전 — 준비되면 채움
    checkInTime: '15:00',
    checkOutTime: '11:00',
    addressKo: '서울 종로구 북촌로15길 37',
    status: 'coming_soon',
    openingLabel: '10월 오픈 예정',
  },
};

// 홈페이지 카드 순서 — coming_soon 은 뒤로.
export const PROPERTY_DISPLAY_ORDER: string[] = [
  'unwadang', 'hwayeonjae', 'anon', 'dowonjae', 'byeolha', 'jarakheon',
];

export function getPropertyDisplay(slug: string): PropertyDisplay | null {
  return PROPERTY_DISPLAY[slug] ?? null;
}

// 이미지 파일들을 { src, webp } 페어 배열로 반환. 페이지가 <Image> 로 로드.
export function propertyImagePaths(display: PropertyDisplay): { src: string; webp: string }[] {
  return display.imageFiles.map((f) => ({
    src: `/images/${display.imageFolder}/${f}.jpg`,
    webp: `/images/${display.imageFolder}/${f}.webp`,
  }));
}
