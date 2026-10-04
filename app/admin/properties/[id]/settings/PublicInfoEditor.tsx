'use client';

import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, X } from 'lucide-react';
import { toast } from '@/components/ui';
import type { PropertyPublicInfo } from '@/lib/property-public-info';

export const EMPTY_PUBLIC_INFO: PropertyPublicInfo = { region: '', addressKo: '', catchphrase: '', checkInTime: '15:00', checkOutTime: '11:00', images: [] };
const fieldClass = 'w-full min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm';

export default function PublicInfoEditor({ propertyId, value, onChange, status, onStatusChange, slug, onSlugChange, openingDate, onOpeningDateChange, missing, onUploadingChange }: {
  propertyId: string; value: PropertyPublicInfo; onChange: (value: PropertyPublicInfo) => void;
  status: string; onStatusChange: (value: string) => void; slug: string; onSlugChange: (value: string) => void;
  openingDate: string; onOpeningDateChange: (value: string) => void; missing: string[]; onUploadingChange: (value: boolean) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const change = (key: keyof PropertyPublicInfo, next: string) => onChange({ ...value, [key]: next });
  const upload = async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    const selected = Array.from(files);
    if (selected.length + value.images.length > 24) { toast.error('사진은 최대 24장까지 등록할 수 있습니다.'); return; }
    setUploading(true); onUploadingChange(true);
    const uploaded: string[] = [];
    let failure = '';
    for (const file of selected) {
      try {
        const response = await fetch(`/api/uploads/property-image?propertyId=${encodeURIComponent(propertyId)}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '사진 등록에 실패했습니다.');
        uploaded.push(data.url);
      } catch (error) { failure = error instanceof Error ? error.message : '사진 등록에 실패했습니다.'; break; }
    }
    if (uploaded.length) onChange({ ...value, images: [...value.images, ...uploaded] });
    if (failure) toast.error(failure);
    else toast.success('사진이 준비되었습니다. 변경사항을 저장해 주세요.');
    setUploading(false); onUploadingChange(false);
    if (fileInput.current) fileInput.current.value = '';
  };
  const move = (index: number, delta: number) => {
    const images = [...value.images];
    [images[index], images[index + delta]] = [images[index + delta], images[index]];
    onChange({ ...value, images });
  };
  return <section className="max-w-3xl rounded-xl border border-stone-200 bg-white p-4 sm:p-8" aria-label="예약 페이지 공개 설정">
    <h2 className="text-lg font-medium text-stone-900">예약 페이지 공개 설정</h2>
    <p className="mt-2 text-sm leading-6 text-stone-500">승인된 새 지점은 준비 중으로 시작합니다. 소개·사진·예약 연동 정보를 입력한 뒤 공개해 주세요.</p>
    <div className="mt-6 grid gap-5 sm:grid-cols-2">
      <label className="block text-sm">공개 상태<select className={fieldClass + ' mt-2'} value={status} onChange={event => onStatusChange(event.target.value)} disabled={uploading}>
        <option value="coming_soon">준비 중 · 예약 불가</option><option value="active">공개 · 예약 가능</option><option value="closed">숨김 · 공개 중지</option>
      </select></label>
      <label className="block text-sm">예약 페이지 주소<input className={fieldClass + ' mt-2'} value={slug} onChange={event => onSlugChange(event.target.value)} placeholder="예: new-stay" disabled={uploading} />
        <span className="mt-1 block break-all text-xs text-stone-500">/book/{slug || '숙소주소'} · 영문 소문자, 숫자, 하이픈</span>
      </label>
      <label className="block text-sm">지역<input className={fieldClass + ' mt-2'} value={value.region} onChange={event => change('region', event.target.value)} placeholder="예: 서울 종로" disabled={uploading} /></label>
      <label className="block text-sm">오픈 안내<input className={fieldClass + ' mt-2'} value={openingDate} onChange={event => onOpeningDateChange(event.target.value)} placeholder="예: 2026년 11월 오픈 예정" disabled={uploading} /></label>
      <label className="block text-sm sm:col-span-2">주소<input className={fieldClass + ' mt-2'} value={value.addressKo} onChange={event => change('addressKo', event.target.value)} placeholder="숙소의 도로명 주소" disabled={uploading} /></label>
      <label className="block text-sm sm:col-span-2">한 줄 소개<input className={fieldClass + ' mt-2'} value={value.catchphrase} onChange={event => change('catchphrase', event.target.value)} placeholder="숙소의 특징을 간결하게 소개해 주세요." disabled={uploading} /></label>
      <label className="block text-sm">체크인 시간<input type="time" className={fieldClass + ' mt-2'} value={value.checkInTime} onChange={event => change('checkInTime', event.target.value)} disabled={uploading} /></label>
      <label className="block text-sm">체크아웃 시간<input type="time" className={fieldClass + ' mt-2'} value={value.checkOutTime} onChange={event => change('checkOutTime', event.target.value)} disabled={uploading} /></label>
    </div>
    <div className="mt-6 flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium">숙소 사진 · {value.images.length}/24</h3><p className="mt-1 text-xs leading-5 text-stone-500">첫 사진이 대표 사진입니다. 화살표로 순서를 바꿀 수 있습니다.</p></div>
      <button type="button" className="flex shrink-0 items-center gap-2 rounded-lg border border-stone-300 px-3 py-2.5 text-sm disabled:opacity-50" disabled={uploading || value.images.length >= 24} onClick={() => fileInput.current?.click()}><ImagePlus size={16} />{uploading ? '등록 중…' : '사진 추가'}</button>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={event => void upload(event.target.files)} />
    </div>
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {value.images.map((src, index) => <div key={`${src}-${index}`} className="min-w-0 overflow-hidden rounded-lg border border-stone-200">
        <div className="relative">
        {/* Uploaded media is already compressed; a native image also supports new storage hosts. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`숙소 사진 ${index + 1}${index === 0 ? ' · 대표 사진' : ''}`} className="aspect-[4/3] w-full object-cover" />
        <span className="absolute left-2 top-2 rounded bg-white/90 px-2 py-1 text-xs">{index === 0 ? '대표' : index + 1}</span>
        <button type="button" className="absolute right-0 top-0 flex min-h-11 min-w-11 items-center justify-center rounded-bl-lg bg-white/90 text-red-600 disabled:opacity-25" aria-label={`사진 ${index + 1} 제거`} disabled={uploading} onClick={() => onChange({ ...value, images: value.images.filter((_, item) => item !== index) })}><X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 gap-1 px-2 py-1">
          <button type="button" className="flex min-h-11 items-center justify-center rounded disabled:opacity-25" aria-label={`사진 ${index + 1} 앞으로`} disabled={uploading || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
          <button type="button" className="flex min-h-11 items-center justify-center rounded disabled:opacity-25" aria-label={`사진 ${index + 1} 뒤로`} disabled={uploading || index === value.images.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
        </div>
      </div>)}
    </div>
    <div className={'mt-6 rounded-lg p-4 text-sm leading-6 ' + (missing.length ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900')} role="status">
      {missing.length ? `공개 준비에 필요한 정보: ${missing.join(', ')}` : '공개에 필요한 기본 정보가 준비되었습니다.'}
    </div>
  </section>;
}
