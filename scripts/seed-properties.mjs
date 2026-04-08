/**
 * 숙소 시딩 스크립트
 * - 기존 3개(화연재, 운와당, 안온재): images/region 등 새 필드 업데이트
 * - 도원재: 신규 생성
 *
 * 사용법:
 *   ADMIN_EMAIL=your@email.com ADMIN_PASSWORD=yourpass npm run seed
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs, addDoc, doc, updateDoc } from 'firebase/firestore';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';

// Firebase 설정 로드
const configPath = new URL('../firebase-config.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const firebaseConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// ─── 4개 숙소 데이터 ───────────────────────────────────────────────────────

const PROPERTIES = [
  {
    name: '화연재',
    region: '서울',
    imageUrl: '/images/hwayeon/hwayeon_after.webp',
    images: [
      '/images/hwayeon/hwayeon_after.webp',
      '/images/hwayeon/DSC04187.webp',
      '/images/hwayeon/DSC04192.webp',
      '/images/hwayeon/DSC04190.webp',
    ],
    description: '전통 한옥의 고즈넉함과 현대적 감각이 어우러진 공간. 서울 도심 속 고요한 머무름을 경험하세요.',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    maxGuests: 4,
  },
  {
    name: '운와당',
    region: '서울',
    imageUrl: '/images/unwa/main.webp',
    images: [
      '/images/unwa/main.webp',
      '/images/unwa/DSC08643.webp',
      '/images/unwa/DSC08753.webp',
      '/images/unwa/KakaoTalk_20240923_163616948.webp',
    ],
    description: '구름이 머무는 집. 전통 한옥의 정취와 자연이 빚어낸 고요한 안식처.',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    maxGuests: 4,
  },
  {
    name: '도원재',
    region: '영주',
    imageUrl: '/images/dowon/main.webp',
    images: [
      '/images/dowon/main.webp',
    ],
    description: '경북 영주, 무섬마을 인근의 고택. 시간이 멈춘 듯한 한옥에서의 특별한 하루.',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    maxGuests: 6,
  },
  {
    name: '안온재',
    region: '서울',
    imageUrl: '/images/anon/main.webp',
    images: [
      '/images/anon/main.webp',
      '/images/anon/DSC09386.webp',
      '/images/anon/DSC09295.webp',
      '/images/anon/DSC09279.webp',
    ],
    description: '편안하고 온전한 쉼. 전통과 현대가 조화롭게 공존하는 도심 속 한옥 스테이.',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    maxGuests: 2,
  },
];

// 업데이트할 필드 (기존 숙소에 추가할 필드만)
const UPDATE_FIELDS = ['region', 'imageUrl', 'images', 'description', 'checkInTime', 'checkOutTime', 'maxGuests'];

// ─── 메인 ──────────────────────────────────────────────────────────────────

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('ADMIN_EMAIL과 ADMIN_PASSWORD 환경변수를 설정해주세요.');
    console.error('  ADMIN_EMAIL=your@email.com ADMIN_PASSWORD=yourpass npm run seed');
    process.exit(1);
  }

  // 로그인
  console.log(`\n  ${email} 으로 로그인 중...`);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  console.log(`  로그인 성공 (uid: ${uid})\n`);

  for (const prop of PROPERTIES) {
    // 기존 문서 검색
    const existing = await getDocs(
      query(collection(db, 'properties'), where('name', '==', prop.name))
    );

    if (!existing.empty) {
      // 기존 숙소 → 새 필드만 업데이트
      const existingDoc = existing.docs[0];
      const updates = {};
      for (const field of UPDATE_FIELDS) {
        if (prop[field] !== undefined) {
          updates[field] = prop[field];
        }
      }
      updates.updatedAt = new Date().toISOString();

      await updateDoc(doc(db, 'properties', existingDoc.id), updates);
      console.log(`  [업데이트] "${prop.name}" (id: ${existingDoc.id})`);
    } else {
      // 도원재 등 신규 → 전체 문서 생성
      const channels = {};
      for (const chName of ['Airbnb', 'Booking.com', 'Stayfolio']) {
        const token = randomUUID();
        channels[chName] = {
          importUrl: '',
          exportUrl: `/api/export/${token}.ics`,
          isActive: false,
          createdAt: new Date().toISOString(),
        };
      }

      const docRef = await addDoc(collection(db, 'properties'), {
        name: prop.name,
        timezone: 'Asia/Seoul',
        region: prop.region,
        ownerId: uid,
        imageUrl: prop.imageUrl,
        images: prop.images,
        description: prop.description,
        checkInTime: prop.checkInTime,
        checkOutTime: prop.checkOutTime,
        maxGuests: prop.maxGuests,
        basePrice: null,
        channels,
        createdAt: new Date().toISOString(),
      });

      console.log(`  [생성] "${prop.name}" -> ${docRef.id}`);
    }
  }

  console.log('\n  시딩 완료!\n');
  process.exit(0);
}

main().catch(err => {
  console.error('시딩 실패:', err.message);
  process.exit(1);
});
