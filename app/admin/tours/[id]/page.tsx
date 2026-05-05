'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Save, Trash2, CalendarDays, BookOpen, Loader2, ExternalLink, Plus, X, Upload, ImagePlus } from 'lucide-react';

interface OperatorOption { id: string; name: string }

interface DurationOption {
  id: string;
  label: string | null;
  durationMin: number;
  price: number;
  sortOrder: number;
}

interface TicketTier {
  id: string;
  label: string;
  price: number;
  notes: string | null;
  sortOrder: number;
}

interface TourDetail {
  id: string;
  title: string;
  slug: string;
  category: string | null;
  description: string | null;
  meetingPoint: string | null;
  maxGroupSize: number | null;
  isActive: boolean;
  operatorId: string | null;
  images: string[];
  durationOptions: DurationOption[];
  ticketTiers: TicketTier[];
  _count?: { bookings: number };
}

const CATEGORY_OPTIONS = [
  { value: '', label: '미지정' },
  { value: 'hanbok', label: '한복' },
  { value: 'guide', label: '가이드 투어' },
  { value: 'tea', label: '다도' },
  { value: 'craft', label: '공예' },
  { value: 'food', label: '음식' },
  { value: 'other', label: '기타' },
];

export default function TourDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [tour, setTour] = useState<TourDetail | null>(null);
  const [operators, setOperators] = useState<OperatorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // duration option draft (for adding)
  const [newOption, setNewOption] = useState({ label: '', durationMin: '60', price: '' });
  const [savingOptionId, setSavingOptionId] = useState<string | null>(null);

  // ticket tier draft (for adding)
  const [newTier, setNewTier] = useState({ label: '', price: '', notes: '' });
  const [savingTierId, setSavingTierId] = useState<string | null>(null);

  // image upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const loadTour = async () => {
    try {
      const res = await fetch(`/api/tours/${id}`);
      if (res.ok) {
        const data = await res.json();
        setTour({
          id: data.id,
          title: data.title,
          slug: data.slug,
          category: data.category,
          description: data.description,
          meetingPoint: data.meetingPoint,
          maxGroupSize: data.maxGroupSize,
          isActive: data.isActive,
          operatorId: data.operatorId,
          images: data.images ?? [],
          durationOptions: data.durationOptions ?? [],
          ticketTiers: data.ticketTiers ?? [],
          _count: data._count,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      await Promise.all([
        loadTour(),
        fetch('/api/tour-operators').then(async r => r.ok ? setOperators(await r.json()) : null),
      ]);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSave = async () => {
    if (!tour) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tours', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: tour.id,
          title: tour.title,
          slug: tour.slug,
          category: tour.category,
          description: tour.description,
          meetingPoint: tour.meetingPoint,
          maxGroupSize: tour.maxGroupSize,
          isActive: tour.isActive,
          operatorId: tour.operatorId,
          images: tour.images,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed');
      }
      router.push('/admin/tours');
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : '저장에 실패했습니다.');
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('이 투어를 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`/api/tours?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || '삭제에 실패했습니다.');
        return;
      }
      router.push('/admin/tours');
    } catch (err) {
      console.error(err);
      alert('삭제에 실패했습니다.');
    }
  };

  const handleAddOption = async () => {
    if (!newOption.durationMin || !newOption.price) return;
    setSavingOptionId('new');
    try {
      const res = await fetch(`/api/tours/${id}/duration-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newOption.label.trim() || null,
          durationMin: Number(newOption.durationMin),
          price: Number(newOption.price),
          sortOrder: tour?.durationOptions.length ?? 0,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || '코스 추가에 실패했습니다.');
        return;
      }
      setNewOption({ label: '', durationMin: '60', price: '' });
      await loadTour();
    } finally {
      setSavingOptionId(null);
    }
  };

  const handleUpdateOption = async (opt: DurationOption) => {
    setSavingOptionId(opt.id);
    try {
      await fetch(`/api/tours/${id}/duration-options`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          optionId: opt.id,
          label: opt.label,
          durationMin: opt.durationMin,
          price: opt.price,
          sortOrder: opt.sortOrder,
        }),
      });
    } finally {
      setSavingOptionId(null);
    }
  };

  const handleDeleteOption = async (optionId: string) => {
    if (!confirm('이 코스 옵션을 삭제하시겠습니까?')) return;
    const res = await fetch(`/api/tours/${id}/duration-options?optionId=${optionId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '삭제에 실패했습니다.');
      return;
    }
    await loadTour();
  };

  const updateOptionLocal = (optId: string, field: keyof DurationOption, value: string | number | null) => {
    setTour(prev => prev ? {
      ...prev,
      durationOptions: prev.durationOptions.map(o => o.id === optId ? { ...o, [field]: value } : o),
    } : prev);
  };

  // ── Ticket tier handlers ────────────────────────────────────────────
  const handleAddTier = async () => {
    if (!newTier.label.trim() || newTier.price === '') return;
    setSavingTierId('new');
    try {
      const res = await fetch(`/api/tours/${id}/ticket-tiers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newTier.label.trim(),
          price: Number(newTier.price),
          notes: newTier.notes.trim() || null,
          sortOrder: tour?.ticketTiers.length ?? 0,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || '티켓 추가에 실패했습니다.');
        return;
      }
      setNewTier({ label: '', price: '', notes: '' });
      await loadTour();
    } finally {
      setSavingTierId(null);
    }
  };

  const handleUpdateTier = async (tier: TicketTier) => {
    setSavingTierId(tier.id);
    try {
      await fetch(`/api/tours/${id}/ticket-tiers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tierId: tier.id,
          label: tier.label,
          price: tier.price,
          notes: tier.notes,
          sortOrder: tier.sortOrder,
        }),
      });
    } finally {
      setSavingTierId(null);
    }
  };

  const handleDeleteTier = async (tierId: string) => {
    if (!confirm('이 티켓 종류를 삭제하시겠습니까?')) return;
    const res = await fetch(`/api/tours/${id}/ticket-tiers?tierId=${tierId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '삭제에 실패했습니다.');
      return;
    }
    await loadTour();
  };

  const updateTierLocal = (tierId: string, field: keyof TicketTier, value: string | number | null) => {
    setTour(prev => prev ? {
      ...prev,
      ticketTiers: prev.ticketTiers.map(t => t.id === tierId ? { ...t, [field]: value } : t),
    } : prev);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      // Send the file as raw body — sidesteps Next 15 + Turbopack's
      // multipart parsing bug. Filename is URL-encoded so non-ASCII
      // characters round-trip safely through the header.
      const res = await fetch('/api/uploads/tour-image', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'x-filename': encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? '업로드 실패');
        return;
      }
      // append to images and persist via PUT /api/tours
      const nextImages = [...(tour?.images ?? []), data.url];
      await fetch('/api/tours', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, images: nextImages }),
      });
      setTour(prev => prev ? { ...prev, images: nextImages } : prev);
    } catch (err) {
      console.error(err);
      setUploadError('업로드에 실패했습니다.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = async (url: string) => {
    if (!tour) return;
    if (!confirm('이 사진을 제거하시겠습니까? 파일 자체는 스토리지에 남습니다.')) return;
    const nextImages = tour.images.filter(u => u !== url);
    await fetch('/api/tours', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, images: nextImages }),
    });
    setTour({ ...tour, images: nextImages });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={20} className="animate-spin text-[var(--brand)]" />
      </div>
    );
  }
  if (!tour) {
    return <p className="text-stone-500 text-sm">투어를 찾을 수 없습니다.</p>;
  }

  const update = <K extends keyof TourDetail>(field: K, value: TourDetail[K]) => {
    setTour(prev => prev ? { ...prev, [field]: value } : prev);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <Link href="/admin/tours" className="inline-flex items-center gap-1 text-xs uppercase tracking-widest text-stone-500 hover:text-stone-900 transition-colors">
        <ChevronLeft size={14} /> 투어 목록
      </Link>

      <header className="border-b border-stone-200 pb-6 sm:pb-7">
        <p className="text-[11px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">투어 호스팅</p>
        <div className="flex items-center justify-between gap-4 mb-3">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">{tour.title}</h1>
          <button
            type="button"
            onClick={() => update('isActive', !tour.isActive)}
            className={`text-[10px] uppercase tracking-widest px-3 py-1.5 border transition-colors ${
              tour.isActive
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                : 'bg-stone-100 text-stone-500 border-stone-200 hover:bg-stone-200'
            }`}
          >
            {tour.isActive ? '판매중' : '비활성'}
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-stone-500">
          <span>예약 {tour._count?.bookings ?? 0}건</span>
          <a
            href={`/tours/${tour.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-stone-900 transition-colors"
          >
            <ExternalLink size={12} /> 공개 페이지
          </a>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href={`/admin/tours/${tour.id}/schedule`}
          className="bg-white border border-stone-200 hover:border-[var(--brand)] p-5 flex items-center justify-between group transition-colors"
        >
          <div>
            <p className="text-[10px] uppercase tracking-widest text-stone-500 mb-1">관리</p>
            <p className="text-sm font-medium text-stone-900">일정 · 재고</p>
          </div>
          <CalendarDays size={20} className="text-stone-400 group-hover:text-[var(--brand)]" />
        </Link>
        <Link
          href={`/admin/tour-bookings?tourId=${tour.id}`}
          className="bg-white border border-stone-200 hover:border-[var(--brand)] p-5 flex items-center justify-between group transition-colors"
        >
          <div>
            <p className="text-[10px] uppercase tracking-widest text-stone-500 mb-1">관리</p>
            <p className="text-sm font-medium text-stone-900">예약 내역</p>
          </div>
          <BookOpen size={20} className="text-stone-400 group-hover:text-[var(--brand)]" />
        </Link>
      </div>

      {/* Images */}
      <div className="bg-white border border-stone-200 p-6 sm:p-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm tracking-widest font-medium text-stone-900">사진</h2>
          <span className="text-[10px] text-stone-400">{tour.images.length}장</span>
        </div>

        {tour.images.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
            {tour.images.map(url => (
              <div key={url} className="relative aspect-square bg-stone-100 group">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => handleRemoveImage(url)}
                  className="absolute top-1 right-1 w-7 h-7 bg-black/60 hover:bg-red-600 text-white flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                  title="삭제"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full border-2 border-dashed border-stone-300 hover:border-[var(--brand)] p-6 flex flex-col items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader2 size={20} className="animate-spin text-stone-400" /> : <ImagePlus size={22} className="text-stone-400" />}
          <span className="text-xs text-stone-600">
            {uploading ? '업로드 중...' : '클릭하여 사진 업로드 (JPEG/PNG/WEBP, 최대 8MB)'}
          </span>
        </button>
        {uploadError && (
          <p className="mt-2 text-xs text-red-600">{uploadError}</p>
        )}
      </div>

      {/* Course / duration options */}
      <div className="bg-white border border-stone-200 p-6 sm:p-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm tracking-widest font-medium text-stone-900">코스 옵션</h2>
            <p className="text-[11px] text-stone-500 mt-1">시간별로 가격을 다르게 등록하세요. (예: 30분 / 1시간 / 2시간)</p>
          </div>
          <span className="text-[10px] text-stone-400">{tour.durationOptions.length}개</span>
        </div>

        <div className="space-y-2 mb-5">
          {tour.durationOptions.length === 0 && (
            <p className="text-xs text-stone-400 py-3 text-center">등록된 코스가 없습니다.</p>
          )}
          {tour.durationOptions.map(opt => (
            <div key={opt.id} className="flex flex-wrap items-center gap-2 p-3 border border-stone-200 bg-stone-50">
              <input
                type="text"
                placeholder="라벨 (예: 짧은 코스)"
                value={opt.label ?? ''}
                onChange={e => updateOptionLocal(opt.id, 'label', e.target.value || null)}
                className="flex-1 min-w-[140px] bg-white border border-stone-200 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] transition-colors"
              />
              <input
                type="number"
                min="1"
                value={opt.durationMin}
                onChange={e => updateOptionLocal(opt.id, 'durationMin', Number(e.target.value) || 0)}
                className="w-20 bg-white border border-stone-200 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] transition-colors"
              />
              <span className="text-xs text-stone-500">분</span>
              <input
                type="number"
                min="0"
                value={opt.price}
                onChange={e => updateOptionLocal(opt.id, 'price', Number(e.target.value) || 0)}
                className="w-28 bg-white border border-stone-200 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] transition-colors"
              />
              <span className="text-xs text-stone-500">원/인</span>
              <div className="flex items-center gap-1 ml-auto">
                <button
                  type="button"
                  onClick={() => handleUpdateOption(opt)}
                  disabled={savingOptionId === opt.id}
                  className="text-[10px] uppercase tracking-widest px-3 py-1.5 bg-stone-100 hover:bg-[var(--brand)] hover:text-white text-stone-700 transition-colors disabled:opacity-50"
                >
                  저장
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteOption(opt.id)}
                  className="p-1.5 text-stone-400 hover:text-red-600 transition-colors"
                  title="삭제"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add new option row */}
        <div className="flex flex-wrap items-center gap-2 p-3 border-2 border-dashed border-stone-300">
          <input
            type="text"
            placeholder="라벨 (선택)"
            value={newOption.label}
            onChange={e => setNewOption({ ...newOption, label: e.target.value })}
            className="flex-1 min-w-[140px] bg-white border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-[var(--brand)]"
          />
          <input
            type="number"
            min="1"
            placeholder="분"
            value={newOption.durationMin}
            onChange={e => setNewOption({ ...newOption, durationMin: e.target.value })}
            className="w-20 bg-white border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-[var(--brand)]"
          />
          <span className="text-xs text-stone-500">분</span>
          <input
            type="number"
            min="0"
            placeholder="가격"
            value={newOption.price}
            onChange={e => setNewOption({ ...newOption, price: e.target.value })}
            className="w-28 bg-white border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-[var(--brand)]"
          />
          <span className="text-xs text-stone-500">원/인</span>
          <button
            type="button"
            onClick={handleAddOption}
            disabled={!newOption.durationMin || !newOption.price || savingOptionId === 'new'}
            className="ml-auto text-[10px] uppercase tracking-widest px-4 py-2 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white transition-colors disabled:opacity-50 inline-flex items-center gap-1"
          >
            <Plus size={12} /> 추가
          </button>
        </div>
      </div>

      {/* Ticket tiers — 성인/어린이/영유아 같은 가격 종류 */}
      <div className="bg-white border border-stone-200 p-6 sm:p-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm tracking-widest font-medium text-stone-900">티켓 종류</h2>
            <p className="text-[11px] text-stone-500 mt-1">한 예약에 여러 명이 섞일 수 있을 때 사용 (예: 성인 + 어린이 + 영유아)</p>
          </div>
          <span className="text-[10px] text-stone-400">{tour.ticketTiers.length}개</span>
        </div>

        <div className="space-y-2 mb-5">
          {tour.ticketTiers.length === 0 && (
            <p className="text-xs text-stone-400 py-3 text-center">등록된 티켓 종류가 없습니다.</p>
          )}
          {tour.ticketTiers.map(tier => (
            <div key={tier.id} className="flex flex-wrap items-center gap-2 p-3 border border-stone-200 bg-stone-50">
              <input
                type="text"
                placeholder="이름 (예: 성인)"
                value={tier.label}
                onChange={e => updateTierLocal(tier.id, 'label', e.target.value)}
                className="flex-1 min-w-[120px] bg-white border border-stone-200 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)]"
              />
              <input
                type="number"
                min="0"
                value={tier.price}
                onChange={e => updateTierLocal(tier.id, 'price', Number(e.target.value) || 0)}
                className="w-28 bg-white border border-stone-200 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)]"
              />
              <span className="text-xs text-stone-500">원/인</span>
              <input
                type="text"
                placeholder="비고 (예: 4-7세)"
                value={tier.notes ?? ''}
                onChange={e => updateTierLocal(tier.id, 'notes', e.target.value || null)}
                className="flex-1 min-w-[120px] bg-white border border-stone-200 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)]"
              />
              <div className="flex items-center gap-1 ml-auto">
                <button
                  type="button"
                  onClick={() => handleUpdateTier(tier)}
                  disabled={savingTierId === tier.id}
                  className="text-[10px] uppercase tracking-widest px-3 py-1.5 bg-stone-100 hover:bg-[var(--brand)] hover:text-white text-stone-700 transition-colors disabled:opacity-50"
                >
                  저장
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteTier(tier.id)}
                  className="p-1.5 text-stone-400 hover:text-red-600 transition-colors"
                  title="삭제"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add new tier */}
        <div className="flex flex-wrap items-center gap-2 p-3 border-2 border-dashed border-stone-300">
          <input
            type="text"
            placeholder="이름 (예: 성인)"
            value={newTier.label}
            onChange={e => setNewTier({ ...newTier, label: e.target.value })}
            className="flex-1 min-w-[120px] bg-white border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-[var(--brand)]"
          />
          <input
            type="number"
            min="0"
            placeholder="가격"
            value={newTier.price}
            onChange={e => setNewTier({ ...newTier, price: e.target.value })}
            className="w-28 bg-white border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-[var(--brand)]"
          />
          <span className="text-xs text-stone-500">원/인</span>
          <input
            type="text"
            placeholder="비고 (선택, 예: 4-7세)"
            value={newTier.notes}
            onChange={e => setNewTier({ ...newTier, notes: e.target.value })}
            className="flex-1 min-w-[120px] bg-white border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-[var(--brand)]"
          />
          <button
            type="button"
            onClick={handleAddTier}
            disabled={!newTier.label.trim() || newTier.price === '' || savingTierId === 'new'}
            className="ml-auto text-[10px] uppercase tracking-widest px-4 py-2 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white transition-colors disabled:opacity-50 inline-flex items-center gap-1"
          >
            <Plus size={12} /> 추가
          </button>
        </div>
      </div>

      {/* Basic info */}
      <div className="bg-white border border-stone-200 p-6 sm:p-8 space-y-5">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">투어명</label>
          <input
            type="text"
            value={tour.title}
            onChange={e => update('title', e.target.value)}
            className="w-full bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">슬러그(URL)</label>
          <input
            type="text"
            value={tour.slug}
            onChange={e => update('slug', e.target.value)}
            className="w-full bg-white border border-stone-200 px-4 py-3 text-sm font-mono text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
          />
          <p className="text-[10px] text-stone-400 mt-1.5">/tours/{tour.slug}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">운영업체</label>
            <select
              value={tour.operatorId ?? ''}
              onChange={e => update('operatorId', e.target.value || null)}
              className="w-full bg-white border border-stone-200 px-4 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
            >
              <option value="">미지정</option>
              {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">카테고리</label>
            <select
              value={tour.category ?? ''}
              onChange={e => update('category', e.target.value || null)}
              className="w-full bg-white border border-stone-200 px-4 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
            >
              {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">기본 정원</label>
          <input
            type="number"
            value={tour.maxGroupSize ?? ''}
            onChange={e => update('maxGroupSize', e.target.value ? Number(e.target.value) : null)}
            className="w-32 bg-white border border-stone-200 px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
          />
          <p className="text-[10px] text-stone-400 mt-1.5">새 슬롯 생성 시 기본값으로 사용됩니다.</p>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">모임장소</label>
          <input
            type="text"
            value={tour.meetingPoint ?? ''}
            onChange={e => update('meetingPoint', e.target.value || null)}
            className="w-full bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">설명</label>
          <textarea
            value={tour.description ?? ''}
            onChange={e => update('description', e.target.value || null)}
            rows={5}
            className="w-full bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors resize-none"
          />
        </div>

        <div className="flex justify-between gap-3 pt-3 border-t border-stone-200">
          <button
            onClick={handleDelete}
            className="flex items-center gap-2 text-stone-400 hover:text-red-600 px-3 py-2 text-[10px] tracking-widest font-semibold uppercase transition-colors"
          >
            <Trash2 size={13} /> 삭제
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white px-5 py-2.5 text-[10px] tracking-widest font-semibold uppercase transition-colors disabled:opacity-50"
          >
            <Save size={13} />
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
