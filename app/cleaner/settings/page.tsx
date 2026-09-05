'use client';

/**
 * 청소담당자 설정 — 프로필 요약, 캘린더 연동, 로그아웃.
 * 오늘 화면에 매일 보이던 캘린더 연동 안내를 여기로 옮겼다 (한 번 설정하면 끝나는 내용).
 */
import { useEffect, useState } from 'react';
import { CalendarDays, Copy, Check, Link as LinkIcon, LogOut, User } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Button, Card, CardHeader, CardSection, PageHeader, Skeleton, toast } from '@/components/ui';
import { ROLE_LABELS } from '@/lib/constants';

export default function CleanerSettingsPage() {
  const { profile } = useAuth();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/cleaners/me')
      .then(r => (r.ok ? r.json() : { cleaner: null }))
      .then(d => setToken(d?.cleaner?.publicToken ?? null))
      .catch(() => setToken(null));
  }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const icalUrl = token ? `${origin}/c/${token}/ical.ics` : '';
  const subscribeUrl = icalUrl.replace(/^https?:/, 'webcal:');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(icalUrl);
      setCopied(true);
      toast.success('주소를 복사했습니다.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('복사에 실패했습니다. 주소를 길게 눌러 복사해 주세요.');
    }
  };

  const logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    window.location.href = '/login';
  };

  return (
    <div className="space-y-6 pb-nav">
      <PageHeader eyebrow="청소 담당자" title="설정" />

      <Card>
        <CardHeader title="내 정보" right={<User size={18} className="text-stone-400" />} />
        <CardSection className="space-y-2">
          <p className="t-body text-stone-900">{profile?.displayName}</p>
          {profile?.phone && <p className="t-caption text-stone-500">{profile.phone}</p>}
          <p className="t-caption text-stone-500">{profile ? ROLE_LABELS[profile.role] : ''}</p>
        </CardSection>
      </Card>

      <Card>
        <CardHeader
          title="캘린더 연동"
          description="본인 캘린더 앱에 추가하면 배정된 청소 일정이 자동으로 들어옵니다."
          right={<CalendarDays size={18} className="text-stone-400" />}
        />
        <CardSection className="space-y-3">
          {token === undefined ? (
            <Skeleton className="h-11 w-full" />
          ) : !token ? (
            <p className="t-caption text-stone-500">연동 주소가 아직 없습니다. 호스트에게 공개 링크 발급을 요청하세요.</p>
          ) : (
            <>
              <div className="flex gap-2">
                <a href={subscribeUrl} className="flex-1">
                  <Button full icon={<LinkIcon size={16} />}>캘린더에 추가</Button>
                </a>
                <Button variant="secondary" onClick={copy} icon={copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}>
                  {copied ? '복사됨' : '주소 복사'}
                </Button>
              </div>
              <input
                type="text"
                readOnly
                value={icalUrl}
                onFocus={e => e.currentTarget.select()}
                className="w-full bg-stone-50 border border-stone-200 px-3 py-2.5 t-caption text-stone-700 font-mono truncate focus:outline-none"
              />
              <div className="t-caption text-stone-500 space-y-1.5 leading-relaxed">
                <p><span className="text-stone-800">구글 캘린더</span>: 다른 캘린더 + → URL로 추가 → 위 주소 붙여넣기</p>
                <p><span className="text-stone-800">애플 캘린더</span>: &quot;캘린더에 추가&quot; 버튼을 누르고 안내대로 진행</p>
                <p><span className="text-stone-800">네이버 캘린더</span>: 설정 → 외부 캘린더 → URL 추가</p>
              </div>
            </>
          )}
        </CardSection>
      </Card>

      <Button variant="danger" full icon={<LogOut size={16} />} onClick={logout}>로그아웃</Button>
    </div>
  );
}
