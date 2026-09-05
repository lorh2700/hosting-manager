'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Save, Trash2, Copy, Check, Link as LinkIcon } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { toast } from '@/components/ui';

interface Property {
  id: string;
  name: string;
  slug?: string | null;
  timezone: string;
  ownerId: string;
  description?: string;
  basePrice?: number;
  maxGuests?: number;
  beds24PropId?: string;
  beds24RoomId?: string;
  doorPassword?: string;
  addressUrl?: string;
  roomReadyMessage?: string;
}

export default function PropertySettingsPage() {
  const { id } = useParams() as { id: string };
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Seoul');
  const [description, setDescription] = useState('');
  const [basePrice, setBasePrice] = useState<number | ''>('');
  const [maxGuests, setMaxGuests] = useState<number | ''>('');
  const [beds24PropId, setBeds24PropId] = useState('');
  const [beds24RoomId, setBeds24RoomId] = useState('');
  const [doorPassword, setDoorPassword] = useState('');
  const [addressUrl, setAddressUrl] = useState('');
  const [roomReadyMessage, setRoomReadyMessage] = useState('');

  useEffect(() => {
    if (!user) return;

    const fetchProperty = async () => {
      try {
        const res = await fetch(`/api/properties/${id}`);
        if (res.ok) {
          const data = await res.json();
          setProperty(data);
          setName(data.name || '');
          setTimezone(data.timezone || 'Asia/Seoul');
          setDescription(data.description || '');
          setBasePrice(data.basePrice || '');
          setMaxGuests(data.maxGuests || '');
          setBeds24PropId(data.beds24PropId || '');
          setBeds24RoomId(data.beds24RoomId || '');
          setDoorPassword(data.doorPassword || '');
          setAddressUrl(data.addressUrl || '');
          setRoomReadyMessage(data.roomReadyMessage || '');
        }
      } catch (error) {
        console.error('Error fetching property', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProperty();
  }, [id, user]);

  const handleSave = async () => {
    if (!user || !property) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/properties/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          timezone,
          description,
          basePrice: basePrice === '' ? null : Number(basePrice),
          maxGuests: maxGuests === '' ? null : Number(maxGuests),
          beds24PropId: beds24PropId.trim() || null,
          beds24RoomId: beds24RoomId.trim() || null,
          doorPassword: doorPassword.trim() || null,
          addressUrl: addressUrl.trim() || null,
          roomReadyMessage: roomReadyMessage.trim() || null,
          updatedAt: new Date().toISOString()
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('숙소 설정이 저장되었습니다.');
    } catch (error) {
      console.error('Error saving property', error);
      toast.error('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!user || !property) return;
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    setDeleting(true);
    try {
      const res = await fetch(`/api/properties/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      router.push('/admin/properties');
    } catch (error) {
      console.error('Error deleting property', error);
      toast.error('삭제에 실패했습니다.');
      setDeleting(false);
      setDeleteConfirm(false);
    }
  };

  if (loading) return <div className="text-center py-24 text-stone-500 font-light tracking-widest text-[11px]">불러오는 중...</div>;
  if (!property) return <div className="text-center py-24 text-stone-500 font-light tracking-widest text-[11px]">숙소를 찾을 수 없습니다</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col gap-6 md:flex-row md:justify-between md:items-end border-b border-stone-200 pb-8">
        <div>
          <Link href="/admin/properties" className="text-stone-500 hover:text-stone-900 text-[10px] tracking-widest font-medium flex items-center gap-2 mb-6 transition-colors">
            <ArrowLeft size={14} /> 숙소 목록으로 돌아가기
          </Link>
          <h1 className="text-4xl font-light tracking-tight text-stone-900">{property.name}</h1>
          <p className="text-stone-500 mt-2 text-sm font-light tracking-wide">숙소의 기본 정보를 관리하세요.</p>
        </div>
        <div className="flex gap-4">
          <Link
            href={`/book/${id}`}
            target="_blank"
            className="bg-transparent border border-stone-300 text-stone-700 px-6 py-3 text-[11px] tracking-widest font-semibold flex items-center gap-2 hover:bg-stone-100 hover:text-stone-900 transition-colors"
          >
            예약 페이지 보기
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white px-6 py-3 text-[11px] tracking-widest font-semibold uppercase flex items-center gap-3 transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? '저장 중...' : '변경사항 저장'}
          </button>
        </div>
      </header>

      {/* Sub-menu Tabs */}
      <div className="flex border-b border-stone-200 mb-8">
        <Link href={`/admin/properties/${id}`} className={`px-6 py-4 text-[11px] tracking-widest font-semibold border-b-2 transition-colors ${pathname === `/admin/properties/${id}` ? 'border-[var(--brand)] text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-900 hover:border-stone-300'}`}>
          캘린더
        </Link>
        <Link href={`/admin/properties/${id}/channels`} className={`px-6 py-4 text-[11px] tracking-widest font-semibold border-b-2 transition-colors ${pathname === `/admin/properties/${id}/channels` ? 'border-[var(--brand)] text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-900 hover:border-stone-300'}`}>
          채널 연결
        </Link>
        <Link href={`/admin/properties/${id}/settings`} className={`px-6 py-4 text-[11px] tracking-widest font-semibold border-b-2 transition-colors ${pathname === `/admin/properties/${id}/settings` ? 'border-[var(--brand)] text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-900 hover:border-stone-300'}`}>
          숙소 설정
        </Link>
      </div>

      <div className="bg-white border border-stone-200 p-8 max-w-3xl">
        <h2 className="text-lg font-light tracking-wide text-stone-900 mb-8">기본 정보</h2>

        <div className="space-y-6">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">숙소 이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white border border-stone-200 rounded-none px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">시간대 (Timezone)</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full bg-white border border-stone-200 rounded-none px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
            >
              <option value="Asia/Seoul">Asia/Seoul (한국 표준시)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (일본 표준시)</option>
              <option value="America/New_York">America/New_York (동부 표준시)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (태평양 표준시)</option>
              <option value="Europe/London">Europe/London (그리니치 표준시)</option>
              <option value="Europe/Paris">Europe/Paris (중앙유럽 표준시)</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">숙소 설명</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="게스트에게 보여질 숙소에 대한 설명을 입력하세요."
              className="w-full bg-white border border-stone-200 rounded-none px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors resize-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">Beds24 Property ID</label>
              <input
                type="text"
                value={beds24PropId}
                onChange={(e) => setBeds24PropId(e.target.value)}
                placeholder="예: 319544"
                className="w-full bg-white border border-stone-200 rounded-none px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors font-mono"
              />
              <p className="text-[11px] text-stone-400 mt-2">동기화(GET /bookings)에 사용됩니다.</p>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">Beds24 Room ID</label>
              <input
                type="text"
                value={beds24RoomId}
                onChange={(e) => setBeds24RoomId(e.target.value)}
                placeholder="예: 664844"
                className="w-full bg-white border border-stone-200 rounded-none px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors font-mono"
              />
              <p className="text-[11px] text-stone-400 mt-2">예약 생성(POST /bookings)에 사용됩니다.</p>
            </div>
          </div>

          {/* iCal 리다이렉트 URL — Beds24 Room ID 가 설정된 경우에만 표시 */}
          <IcalUrlSection slug={property?.slug ?? null} beds24RoomId={beds24RoomId} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">도어락 비밀번호</label>
              <input
                type="text"
                value={doorPassword}
                onChange={(e) => setDoorPassword(e.target.value)}
                placeholder="예: 1234*"
                className="w-full bg-white border border-stone-200 rounded-none px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">주소 링크</label>
              <input
                type="url"
                value={addressUrl}
                onChange={(e) => setAddressUrl(e.target.value)}
                placeholder="예: https://naver.me/..."
                className="w-full bg-white border border-stone-200 rounded-none px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">정비 완료 메시지 템플릿</label>
            <textarea
              value={roomReadyMessage}
              onChange={(e) => setRoomReadyMessage(e.target.value)}
              rows={4}
              placeholder="비워두면 기본 메시지가 사용됩니다. {password}와 {address}를 사용하면 위 정보로 자동 치환됩니다."
              className="w-full bg-white border border-stone-200 rounded-none px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors resize-none"
            />
            <p className="text-[11px] text-stone-400 mt-2">사용 가능 변수: {'{password}'} = 도어락 비밀번호, {'{address}'} = 주소 링크</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">기본 1박 요금 (₩)</label>
              <input
                type="number"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value ? Number(e.target.value) : '')}
                placeholder="예: 150000"
                className="w-full bg-white border border-stone-200 rounded-none px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">최대 수용 인원 (명)</label>
              <input
                type="number"
                value={maxGuests}
                onChange={(e) => setMaxGuests(e.target.value ? Number(e.target.value) : '')}
                placeholder="예: 4"
                className="w-full bg-white border border-stone-200 rounded-none px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-red-50 border border-red-200 p-8 max-w-3xl mt-12">
        <h2 className="text-lg font-light tracking-wide text-red-600 mb-2">위험 구역</h2>
        <p className="text-xs text-red-600/70 mb-6">숙소를 삭제하면 연동된 모든 채널과 예약 정보가 함께 삭제되며 복구할 수 없습니다.</p>
        {deleteConfirm ? (
          <div className="flex items-center gap-4">
            <span className="text-xs text-red-600">정말 삭제하시겠습니까? 채널, 이벤트 포함 모두 삭제됩니다.</span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 border border-red-700 text-white px-6 py-3 text-[11px] tracking-widest font-semibold flex items-center gap-3 hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              <Trash2 size={16} />
              {deleting ? '삭제 중...' : '확인 — 영구 삭제'}
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              className="text-stone-500 hover:text-stone-900 text-[11px] tracking-widest transition-colors"
            >
              취소
            </button>
          </div>
        ) : (
          <button
            onClick={handleDelete}
            className="bg-transparent border border-red-300 text-red-600 px-6 py-3 text-[11px] tracking-widest font-semibold flex items-center gap-3 hover:bg-red-100 transition-colors"
          >
            <Trash2 size={16} />
            이 숙소 영구 삭제하기
          </button>
        )}
      </div>
    </div>
  );
}

// ─── iCal URL 섹션 ────────────────────────────────────────────────────
// 이 숙소의 예약 캘린더를 OTA/개인 캘린더로 export 하는 URL.
// - Beds24 Room ID 가 있어야만 URL 이 노출됨 (없으면 안내 문구).
// - Pretty URL (voidanchae.com/ical/{slug}) 은 netlify.toml 리다이렉트 또는
//   /ical/[slug] 동적 라우트가 처리 → Beds24 로 301 리다이렉트.
// - 참고용으로 Beds24 직접 URL 도 함께 표시 (리다이렉트 없이 즉시 동작).

interface IcalUrlSectionProps {
  slug: string | null;
  beds24RoomId: string;
}

function IcalUrlSection({ slug, beds24RoomId }: IcalUrlSectionProps) {
  const [copied, setCopied] = useState<'pretty' | 'direct' | null>(null);

  const trimmedRoomId = beds24RoomId.trim();
  if (!trimmedRoomId) {
    return (
      <div className="border-t border-stone-200 pt-6 mt-6">
        <div className="flex items-center gap-2 mb-2">
          <LinkIcon size={14} className="text-stone-400" />
          <label className="text-[10px] uppercase tracking-widest text-stone-500">iCal 예약 캘린더</label>
        </div>
        <p className="text-[12px] text-stone-400 leading-relaxed">
          Beds24 Room ID 를 저장하면 iCal 링크가 여기에 노출됩니다. OTA (Airbnb / Booking.com 등) 나
          개인 캘린더에 붙여 예약 일정을 자동 동기화할 수 있습니다.
        </p>
      </div>
    );
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://voidanchae.com';
  const prettyUrl = slug ? `${origin}/ical/${slug}` : null;
  const directUrl = `https://api.beds24.com/ical/bookings.ics?roomid=${trimmedRoomId}`;

  const copy = async (url: string, kind: 'pretty' | 'direct') => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch (e) {
      console.error('clipboard write failed', e);
    }
  };

  return (
    <div className="border-t border-stone-200 pt-6 mt-6 space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <LinkIcon size={14} className="text-stone-400" />
          <label className="text-[10px] uppercase tracking-widest text-stone-500">iCal 예약 캘린더</label>
        </div>
        <p className="text-[12px] text-stone-500 leading-relaxed">
          아래 URL 을 OTA (Airbnb, Booking.com 등) 나 Google/Apple 캘린더에 붙여 넣으면 이 숙소의 예약이 자동 동기화됩니다.
        </p>
      </div>

      {prettyUrl && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] uppercase tracking-widest text-stone-600 font-semibold">공유용 URL (권장)</p>
            <button
              type="button"
              onClick={() => copy(prettyUrl, 'pretty')}
              className={`text-[11px] px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
                copied === 'pretty'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
              aria-label="공유용 URL 복사"
            >
              {copied === 'pretty' ? <Check size={12} /> : <Copy size={12} />}
              {copied === 'pretty' ? '복사됨' : '복사'}
            </button>
          </div>
          <code className="block bg-stone-50 border border-stone-200 px-3 py-2 text-[12px] font-mono text-stone-800 break-all">
            {prettyUrl}
          </code>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] uppercase tracking-widest text-stone-500">Beds24 직접 URL</p>
          <button
            type="button"
            onClick={() => copy(directUrl, 'direct')}
            className={`text-[11px] px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
              copied === 'direct'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
            }`}
            aria-label="Beds24 직접 URL 복사"
          >
            {copied === 'direct' ? <Check size={12} /> : <Copy size={12} />}
            {copied === 'direct' ? '복사됨' : '복사'}
          </button>
        </div>
        <code className="block bg-stone-50 border border-stone-200 px-3 py-2 text-[12px] font-mono text-stone-500 break-all">
          {directUrl}
        </code>
        <p className="text-[11px] text-stone-400 mt-1.5">
          리다이렉트 없이 Beds24 서버로 바로 향합니다. 공유용 URL 이 문제 있을 때 fallback 으로 사용.
        </p>
      </div>
    </div>
  );
}
