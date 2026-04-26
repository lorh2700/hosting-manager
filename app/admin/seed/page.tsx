'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

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

const UPDATE_FIELDS = ['region', 'imageUrl', 'images', 'description', 'checkInTime', 'checkOutTime', 'maxGuests'] as const;

export default function SeedPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const log = (msg: string) => setLogs(prev => [...prev, msg]);

  const runSeed = async () => {
    if (!user) return;
    setRunning(true);
    setLogs([]);

    try {
      const res = await fetch('/api/properties');
      const allProperties: any[] = res.ok ? await res.json() : [];

      for (const prop of PROPERTIES) {
        const existing = allProperties.find((p: any) => p.name === prop.name);

        if (existing) {
          const updates: Record<string, unknown> = {};
          for (const field of UPDATE_FIELDS) {
            if (prop[field] !== undefined) {
              updates[field] = prop[field];
            }
          }
          updates.updatedAt = new Date().toISOString();

          const updateRes = await fetch(`/api/properties/${existing.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
          });
          if (!updateRes.ok) throw new Error(`Failed to update ${prop.name}`);
          log(`[업데이트] "${prop.name}" (id: ${existing.id})`);
        } else {
          const createRes = await fetch('/api/properties', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: prop.name,
              timezone: 'Asia/Seoul',
              region: prop.region,
              imageUrl: prop.imageUrl,
              images: prop.images,
              description: prop.description,
              checkInTime: prop.checkInTime,
              checkOutTime: prop.checkOutTime,
              maxGuests: prop.maxGuests,
              basePrice: null,
            }),
          });
          if (!createRes.ok) throw new Error(`Failed to create ${prop.name}`);
          const data = await createRes.json();
          log(`[생성] "${prop.name}" -> ${data.id}`);
        }
      }

      log('\n시딩 완료!');
      setDone(true);
    } catch (err) {
      log(`오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  if (!user) {
    return (
      <div className="p-8 text-center text-stone-500">
        로그인이 필요합니다.
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2 text-stone-900">숙소 데이터 시딩</h1>
      <p className="text-stone-500 mb-8 text-sm">
        기존 3개 숙소(화연재, 운와당, 안온재)에 이미지/지역 데이터를 추가하고, 도원재를 새로 생성합니다.
      </p>

      <div className="mb-6 space-y-2 text-sm">
        {PROPERTIES.map(p => (
          <div key={p.name} className="flex items-center gap-3 p-3 bg-white border border-stone-200">
            <span className="font-medium text-stone-900">{p.name}</span>
            <span className="text-stone-500">{p.region}</span>
            <span className="text-stone-500">{p.images.length}장</span>
          </div>
        ))}
      </div>

      <button
        onClick={runSeed}
        disabled={running || done}
        className={`px-6 py-3 font-semibold text-xs uppercase tracking-widest transition-colors ${
          done
            ? 'bg-green-100 text-green-700 cursor-default'
            : running
              ? 'bg-stone-200 text-stone-500 cursor-wait'
              : 'bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white'
        }`}
      >
        {done ? '완료!' : running ? '처리 중...' : '시딩 실행'}
      </button>

      {logs.length > 0 && (
        <pre className="mt-6 p-4 bg-stone-100 border border-stone-200 text-sm text-stone-700 whitespace-pre-wrap">
          {logs.join('\n')}
        </pre>
      )}
    </div>
  );
}
