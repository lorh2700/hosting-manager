'use client';

/**
 * 숙소 복도 카메라 — 날짜별 스냅샷과 AI 판정.
 * 오늘 화면 카드는 체크아웃이 있는 날에만 사진을 보여주므로, 언제든 확인할 수 있는 전용 화면.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ArrowLeft, Camera, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Badge, Button, EmptyState, PageHeader, SkeletonList, PullToRefresh, toast } from '@/components/ui';
import { useRefetchOnReturn } from '@/lib/hooks/useRefetchOnReturn';
import type { CameraVerdict } from '@/lib/camera-types';

interface Snapshot {
  id: string;
  capturedAt: string;
  url: string | null;
  source: string;
  leaving: boolean;
  verdict: CameraVerdict | null;
  cameraName: string | null;
}

const LUGGAGE_KO: Record<string, string> = { none: '짐 없음', small_bag: '작은 가방', suitcase_or_large_bag: '캐리어·큰 가방', unclear: '불명확' };
const DIRECTION_KO: Record<string, string> = { toward_exit: '현관 쪽', toward_rooms: '객실 쪽', unclear: '방향 불명확' };
const ROLE_KO: Record<string, string> = { guest: '게스트', staff: '직원 단서', unclear: '역할 불명확' };

function shiftDate(date: string, days: number): string {
  const d = parseISO(date);
  d.setDate(d.getDate() + days);
  return format(d, 'yyyy-MM-dd');
}

export default function PropertyCameraPage() {
  const { id } = useParams() as { id: string };
  const { user } = useAuth();
  const [propertyName, setPropertyName] = useState('');
  const [date, setDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [dates, setDates] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Snapshot | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [snapRes, propRes] = await Promise.all([
        fetch(`/api/camera/snapshots?propertyId=${id}&date=${date}`),
        propertyName ? Promise.resolve(null) : fetch(`/api/properties/${id}`),
      ]);
      if (!snapRes.ok) {
        const data = await snapRes.json().catch(() => ({}));
        toast.error(data.error || '사진을 불러오지 못했습니다.');
        return;
      }
      const data = await snapRes.json();
      setSnapshots(data.snapshots ?? []);
      setDates(data.dates ?? []);
      if (propRes && propRes.ok) setPropertyName((await propRes.json()).name ?? '');
    } catch {
      toast.error('사진을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [id, date, propertyName]);

  useEffect(() => { if (user) load(); }, [user, load]);
  useRefetchOnReturn(() => load(true));

  const leavingCount = snapshots.filter(s => s.leaving).length;
  const judgedCount = snapshots.filter(s => s.verdict).length;

  return (
    <PullToRefresh onRefresh={() => load(true)}>
      <div className="max-w-4xl mx-auto space-y-6 pb-nav">
        <Link href={`/admin/properties/${id}`} className="inline-flex items-center gap-1.5 t-caption text-stone-500 hover:text-stone-900">
          <ArrowLeft size={14} /> {propertyName || '숙소'}로 돌아가기
        </Link>
        <PageHeader
          eyebrow="복도 카메라"
          title={propertyName ? `${propertyName} 복도` : '복도 카메라'}
          description="카메라가 사람을 감지해 보낸 사진과, 체크아웃 시간대의 AI 판정입니다. 사진은 30일 뒤 자동 삭제됩니다."
        />

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={<ChevronLeft size={16} />} onClick={() => setDate(d => shiftDate(d, -1))} aria-label="이전 날" />
          <input
            type="date"
            value={date}
            max={format(new Date(), 'yyyy-MM-dd')}
            onChange={e => e.target.value && setDate(e.target.value)}
            className="bg-white border border-stone-300 px-3 min-h-[36px] t-caption text-stone-900"
          />
          <Button variant="secondary" size="sm" icon={<ChevronRight size={16} />} onClick={() => setDate(d => shiftDate(d, 1))} disabled={date >= format(new Date(), 'yyyy-MM-dd')} aria-label="다음 날" />
          <span className="t-caption text-stone-500 ml-2">
            {format(parseISO(date), 'M월 d일 (EEE)', { locale: ko })} · {snapshots.length}장
            {judgedCount > 0 && ` · 판정 ${judgedCount}건`}
            {leavingCount > 0 && ` · 퇴실로 보임 ${leavingCount}건`}
          </span>
        </div>

        {dates.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {dates.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setDate(d)}
                className={`shrink-0 px-3 min-h-[32px] t-micro border ${d === date ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-600 border-stone-200'}`}
              >
                {format(parseISO(d), 'M/d')}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <SkeletonList count={2} rows={2} />
        ) : snapshots.length === 0 ? (
          <EmptyState
            icon={Camera}
            title="이 날짜에는 사진이 없습니다"
            description="카메라가 사람을 감지하면 메일로 보낸 사진이 5분 안에 여기에 들어옵니다. 메일이 안 오면 카메라의 이메일 알림 설정과 받는 주소의 +태그를 확인하세요."
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {snapshots.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s)}
                className={`text-left bg-white border ${s.leaving ? 'border-amber-400' : 'border-stone-200'} overflow-hidden`}
              >
                {s.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.url} alt={`복도 ${format(parseISO(s.capturedAt), 'HH:mm:ss')}`} className="w-full aspect-[4/3] object-cover bg-stone-100" loading="lazy" />
                ) : (
                  <div className="w-full aspect-[4/3] bg-stone-100 flex items-center justify-center t-caption text-stone-400">사진 없음</div>
                )}
                <div className="px-2.5 py-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="t-caption text-stone-900 tabular-nums">{format(parseISO(s.capturedAt), 'HH:mm:ss')}</span>
                    {s.leaving ? <Badge tone="warning">퇴실로 보임</Badge> : s.verdict ? <Badge tone="neutral">판정됨</Badge> : <Badge tone="neutral">저장만</Badge>}
                  </div>
                  {s.verdict?.summary && <p className="t-micro text-stone-500 line-clamp-2">{s.verdict.summary}</p>}
                </div>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="fixed inset-0 z-[60] bg-stone-950/80 flex flex-col" onClick={() => setSelected(null)} role="presentation">
            <div className="flex items-center justify-between px-4 py-3 text-white">
              <span className="t-body">{format(parseISO(selected.capturedAt), 'M월 d일 HH:mm:ss', { locale: ko })}</span>
              <button type="button" className="tap flex items-center justify-center" onClick={() => setSelected(null)} aria-label="닫기">✕</button>
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center px-2" onClick={e => e.stopPropagation()}>
              {selected.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selected.url} alt="복도 사진" className="max-h-full max-w-full object-contain" />
              )}
            </div>
            <div className="bg-white px-5 pt-4 safe-bottom" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }} onClick={e => e.stopPropagation()}>
              {selected.verdict ? (
                <div className="space-y-1.5">
                  <p className="t-body text-stone-900">{selected.verdict.summary}</p>
                  <p className="t-caption text-stone-500">
                    {selected.verdict.peoplePresent ? `사람 ${selected.verdict.personCount}명` : '사람 없음'} · {LUGGAGE_KO[selected.verdict.luggage] ?? selected.verdict.luggage} · {DIRECTION_KO[selected.verdict.direction] ?? selected.verdict.direction} · {ROLE_KO[selected.verdict.likelyRole] ?? selected.verdict.likelyRole} · 확신도 {Math.round(selected.verdict.confidence * 100)}%
                  </p>
                  <p className="t-micro text-stone-400">{selected.verdict.model}</p>
                </div>
              ) : (
                <p className="t-caption text-stone-500">판정하지 않은 사진입니다. 판정은 09:00~13:30 사이, 그날 체크아웃이 있는 숙소에서만 돕니다.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
