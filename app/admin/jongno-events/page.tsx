'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, CalendarDays, Check, ExternalLink, ImagePlus, Loader2, Plus, RefreshCw, Save, X } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import type { JongnoEventDTO, JongnoEventImage, JongnoEventInput } from '@/lib/jongno-events';
import styles from './JongnoEventsAdmin.module.css';

const CATEGORIES = { festival: '행사·축제', exhibition: '전시', performance: '공연', palace: '궁궐·전통', experience: '체험' } as const;
const AREAS = { bukchon: '북촌·삼청동', insadong: '인사동·광화문', seochon: '서촌', daehakro: '대학로', other: '종로 기타' } as const;
const STATUSES = { draft: '임시 저장', published: '공개', cancelled: '취소·숨김' } as const;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_IMAGES = 6;

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function emptyForm(): JongnoEventInput {
  return {
    titleKo: '', titleEn: '', descriptionKo: '', descriptionEn: '', category: 'festival', area: 'bukchon',
    venue: '', address: '', startDate: today(), endDate: today(), timeText: '',
    excludedWeekdays: [], excludedDates: [], feeType: 'unknown', feeText: '', bookingRequired: false,
    officialUrl: '', bookingUrl: '', mapUrl: '', languageText: '', images: [], status: 'draft', verifiedAt: null,
  };
}

function eventForm(event: JongnoEventDTO): JongnoEventInput {
  const { id: _id, version: _version, updatedAt: _updatedAt, ...input } = event;
  return input;
}

async function readResponse<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const message = value?.error;
    throw new Error(typeof message === 'string' ? message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return value as T;
}

export default function JongnoEventsAdminPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const accountId = user?.id ?? null;
  const allowed = !!accountId && profile?.role === 'super_admin';
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [status, setStatus] = useState('');
  const [events, setEvents] = useState<JongnoEventDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<JongnoEventDTO | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<JongnoEventInput>(emptyForm);
  const [savedForm, setSavedForm] = useState(() => JSON.stringify(emptyForm()));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState(false);
  const [excludedDate, setExcludedDate] = useState('');
  const [removedImages, setRemovedImages] = useState<{ image: JongnoEventImage; index: number }[]>([]);
  const listRequest = useRef<AbortController | null>(null);
  const mutationRequest = useRef<AbortController | null>(null);
  const activeAccount = useRef<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = saving || uploading;
  const dirty = editing && JSON.stringify(form) !== savedForm;

  useEffect(() => {
    activeAccount.current = allowed ? accountId : null;
    setEditing(false);
    setSelected(null);
    setForm(emptyForm());
    setFormError('');
    setNotice('');
    setConflict(false);
    setRemovedImages([]);
    setSaving(false);
    setUploading(false);
    return () => {
      activeAccount.current = null;
      mutationRequest.current?.abort();
    };
  }, [allowed, accountId]);

  const loadList = useCallback(async (cursor?: string) => {
    if (!allowed) return;
    const account = accountId;
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);
    setListError('');
    const params = new URLSearchParams({ limit: '20' });
    if (month) params.set('month', month);
    if (status) params.set('status', status);
    if (cursor) params.set('cursor', cursor);
    try {
      const response = await fetch(`/api/admin/jongno-events?${params}`, { signal: controller.signal, cache: 'no-store' });
      const data = await readResponse<{ events: JongnoEventDTO[]; hasMore: boolean; nextCursor: string | null }>(response);
      if (controller.signal.aborted || activeAccount.current !== account) return;
      setEvents(previous => cursor ? [...previous, ...data.events.filter(event => !previous.some(item => item.id === event.id))] : data.events);
      setNextCursor(data.hasMore ? data.nextCursor : null);
    } catch (error) {
      if (!controller.signal.aborted && activeAccount.current === account) setListError(error instanceof Error ? error.message : '행사를 불러오지 못했습니다.');
    } finally {
      if (!controller.signal.aborted && activeAccount.current === account) setLoading(false);
    }
  }, [allowed, month, status, accountId]);

  useEffect(() => {
    setEvents([]);
    setNextCursor(null);
    void loadList();
    return () => listRequest.current?.abort();
  }, [loadList]);

  useEffect(() => {
    if (!dirty && !busy) return;
    const leavePage = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const leaveLink = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest('a');
      if (!link || link.target === '_blank' || link.hasAttribute('download') || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (busy || !window.confirm('저장하지 않은 변경사항이 있습니다. 이 페이지를 나갈까요?')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', leavePage);
    document.addEventListener('click', leaveLink, true);
    return () => { window.removeEventListener('beforeunload', leavePage); document.removeEventListener('click', leaveLink, true); };
  }, [dirty, busy]);

  function update<K extends keyof JongnoEventInput>(key: K, value: JongnoEventInput[K]) {
    setForm(previous => ({ ...previous, [key]: value }));
    setNotice('');
  }

  function canSwitch() {
    return !busy && (!dirty || window.confirm('저장하지 않은 변경사항을 버리고 이동할까요?'));
  }

  function beginEdit(event: JongnoEventDTO | null) {
    if (!canSwitch()) return;
    const initial = event ? eventForm(event) : emptyForm();
    setSelected(event);
    setForm(initial);
    setSavedForm(JSON.stringify(initial));
    setEditing(true);
    setFormError('');
    setNotice('');
    setConflict(false);
    setPreview(false);
    setExcludedDate('');
    setRemovedImages([]);
    window.setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  async function reloadEvent() {
    if (!selected || !canSwitch()) return;
    const account = activeAccount.current;
    const controller = new AbortController();
    mutationRequest.current = controller;
    setSaving(true);
    setFormError('');
    try {
      const data = await readResponse<{ event: JongnoEventDTO }>(await fetch(`/api/admin/jongno-events/${selected.id}`, { cache: 'no-store', signal: controller.signal }));
      if (controller.signal.aborted || activeAccount.current !== account) return;
      const initial = eventForm(data.event);
      setSelected(data.event);
      setForm(initial);
      setSavedForm(JSON.stringify(initial));
      setConflict(false);
      setNotice('최신 저장 내용을 불러왔습니다.');
      setRemovedImages([]);
      void loadList();
    } catch (error) {
      if (!controller.signal.aborted && activeAccount.current === account) setFormError(error instanceof Error ? error.message : '최신 내용을 불러오지 못했습니다.');
    } finally { if (activeAccount.current === account) setSaving(false); }
  }

  async function saveEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || conflict) return;
    const account = activeAccount.current;
    const controller = new AbortController();
    mutationRequest.current = controller;
    setSaving(true);
    setFormError('');
    setNotice('');
    try {
      const response = await fetch(selected ? `/api/admin/jongno-events/${selected.id}` : '/api/admin/jongno-events', {
        method: selected ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selected ? { ...form, version: selected.version } : form),
        signal: controller.signal,
      });
      if (controller.signal.aborted || activeAccount.current !== account) return;
      if (response.status === 409) {
        setConflict(true);
        throw new Error('다른 화면에서 이 행사가 변경되었습니다. 최신 내용을 불러온 뒤 다시 수정해 주세요.');
      }
      const data = await readResponse<{ event: JongnoEventDTO }>(response);
      if (controller.signal.aborted || activeAccount.current !== account) return;
      const initial = eventForm(data.event);
      setSelected(data.event);
      setForm(initial);
      setSavedForm(JSON.stringify(initial));
      setRemovedImages([]);
      setNotice(data.event.status === 'published' ? '저장했습니다. 종로 행사 캘린더에서 확인할 수 있습니다.' : '저장했습니다. 이 행사는 공개 캘린더에 표시되지 않습니다.');
      void loadList();
    } catch (error) {
      if (!controller.signal.aborted && activeAccount.current === account) setFormError(error instanceof Error ? error.message : '저장하지 못했습니다. 입력한 내용은 유지됩니다.');
    } finally { if (activeAccount.current === account) setSaving(false); }
  }

  async function uploadImages(files: FileList | null) {
    if (!files || busy) return;
    const chosen = Array.from(files);
    if (chosen.length + form.images.length > MAX_IMAGES) {
      setFormError(`사진은 행사당 최대 ${MAX_IMAGES}장까지 등록할 수 있습니다.`);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploading(true);
    const account = activeAccount.current;
    const controller = new AbortController();
    mutationRequest.current = controller;
    setFormError('');
    setNotice('');
    const failures: string[] = [];
    for (const file of chosen) {
      if (controller.signal.aborted || activeAccount.current !== account) break;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
        failures.push(`${file.name}: JPG·PNG·WebP 형식, 8MB 이하 사진을 선택해 주세요.`);
        continue;
      }
      try {
        const response = await fetch('/api/uploads/jongno-event-image', {
          method: 'POST', headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name) }, body: file, signal: controller.signal,
        });
        const result = await readResponse<{ url: string }>(response);
        if (controller.signal.aborted || activeAccount.current !== account) break;
        setForm(previous => ({ ...previous, images: [...previous.images, { url: result.url, alt: '', credit: '', sourceUrl: '' }] }));
      } catch (error) {
        if (!controller.signal.aborted) failures.push(`${file.name}: ${error instanceof Error ? error.message : '업로드에 실패했습니다.'}`);
      }
    }
    if (controller.signal.aborted || activeAccount.current !== account) return;
    setFormError(failures.join('\n'));
    if (!failures.length) setNotice('사진을 추가했습니다. 행사 저장을 눌러 등록을 완료해 주세요.');
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function updateImage(index: number, key: keyof JongnoEventImage, value: string) {
    update('images', form.images.map((image, current) => current === index ? { ...image, [key]: value } : image));
  }

  function moveImage(index: number, offset: number) {
    const images = [...form.images];
    const next = index + offset;
    if (next < 0 || next >= images.length) return;
    [images[index], images[next]] = [images[next], images[index]];
    update('images', images);
  }

  function removeImage(index: number) {
    setRemovedImages(previous => [...previous, { image: form.images[index], index }]);
    update('images', form.images.filter((_, current) => current !== index));
  }

  function undoRemoveImage() {
    const removed = removedImages[removedImages.length - 1];
    if (!removed || form.images.length >= MAX_IMAGES) return;
    const images = [...form.images];
    images.splice(Math.min(removed.index, images.length), 0, removed.image);
    update('images', images);
    setRemovedImages(previous => previous.slice(0, -1));
  }

  if (authLoading) return <div role="status" className={styles.empty}><Loader2 className="animate-spin" size={22} /> 계정 확인 중…</div>;
  if (!allowed) return <section className={styles.denied}><h1>종로 행사 캘린더</h1><p>행사 등록과 수정은 관리자 계정에서 사용할 수 있습니다.</p><Link href="/admin">오늘 화면으로</Link></section>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>게스트 가이드</p><h1>종로 행사 캘린더</h1><p>사진과 일정을 등록하고, 손님에게 공개할 내용을 관리합니다.</p></div>
        <div className={styles.headerActions}>
          <Link href="/guide/jongno-events" target="_blank" rel="noopener noreferrer" className={styles.secondary}><ExternalLink size={16} /> 공개 캘린더</Link>
          <button type="button" className={styles.primary} onClick={() => beginEdit(null)} disabled={busy}><Plus size={17} /> 행사 등록</button>
        </div>
      </header>

      <section className={styles.listSection} aria-label="등록된 행사">
        <div className={styles.filters}>
          <label>행사 기간<input type="month" value={month} onChange={event => setMonth(event.target.value)} disabled={busy} /></label>
          {month && <button type="button" onClick={() => setMonth('')} className={styles.textButton} disabled={busy}>전체 기간</button>}
          <label>공개 상태<select value={status} onChange={event => setStatus(event.target.value)} disabled={busy}>{<option value="">전체</option>}{Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button type="button" onClick={() => void loadList()} disabled={loading || busy} className={styles.secondary} aria-label="행사 목록 새로고침"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
        </div>
        {listError && <div role="alert" className={styles.error}>{listError}<button type="button" onClick={() => void loadList()} disabled={loading}>다시 불러오기</button></div>}
        {loading && !events.length ? <div role="status" className={styles.empty}><Loader2 className="animate-spin" size={20} /> 행사 불러오는 중…</div> : !events.length && !listError ? (
          <div className={styles.empty}><CalendarDays size={30} /><p>선택한 조건에 등록된 행사가 없습니다.</p><button type="button" className={styles.secondary} onClick={() => beginEdit(null)} disabled={busy}>첫 행사 등록</button></div>
        ) : <div className={styles.eventList}>{events.map(event => (
          <button type="button" key={event.id} className={`${styles.eventRow} ${selected?.id === event.id && editing ? styles.eventSelected : ''}`} onClick={() => beginEdit(event)} disabled={busy}>
            <span className={styles.listImage}>{event.images[0] ? <Photo image={event.images[0]} fallback={event.titleKo} /> : <CalendarDays size={22} />}</span>
            <span className={styles.eventInfo}><strong>{event.titleKo}</strong><span>{event.startDate} ~ {event.endDate}</span><span>{event.venue || AREAS[event.area]} · {CATEGORIES[event.category]}</span></span>
            <span className={`${styles.badge} ${event.status === 'published' ? styles.published : ''}`}>{STATUSES[event.status]}</span>
          </button>
        ))}</div>}
        {nextCursor && <button type="button" className={styles.loadMore} onClick={() => void loadList(nextCursor)} disabled={loading || busy}>{loading ? '불러오는 중…' : '행사 더 보기'}</button>}
      </section>

      {editing && <div ref={editorRef} className={styles.editor}>
        <form onSubmit={saveEvent}>
          <div className={styles.editorHeading}><div><p className={styles.eyebrow}>{selected ? '등록된 행사 수정' : '새 행사'}</p><h2>{selected?.titleKo || '행사 내용 입력'}</h2></div><button type="button" className={styles.iconButton} aria-label="행사 편집 닫기" onClick={() => { if (canSwitch()) setEditing(false); }} disabled={busy}><X size={22} /></button></div>
          <fieldset disabled={busy} className={styles.fieldset}>
            <section className={styles.formSection}>
              <h3>기본 정보</h3>
              <div className={styles.fields}>
                <label>행사명 · 한국어 *<input required maxLength={200} value={form.titleKo} onChange={event => update('titleKo', event.target.value)} placeholder="행사 이름" /></label>
                <label>행사명 · 영어<input maxLength={160} value={form.titleEn} onChange={event => update('titleEn', event.target.value)} placeholder="영어 안내를 제공할 경우 입력" /></label>
                <label>분류<select value={form.category} onChange={event => update('category', event.target.value as JongnoEventInput['category'])}>{Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>지역<select value={form.area} onChange={event => update('area', event.target.value as JongnoEventInput['area'])}>{Object.entries(AREAS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>장소명{form.status === 'published' ? ' · 공개 시 필수' : ''}<input required={form.status === 'published'} maxLength={200} value={form.venue} onChange={event => update('venue', event.target.value)} placeholder="예) 서울공예박물관" /></label>
                <label>주소<input maxLength={300} value={form.address} onChange={event => update('address', event.target.value)} placeholder="도로명 주소" /></label>
                <label className={styles.full}>소개 · 한국어<textarea rows={4} maxLength={8000} value={form.descriptionKo} onChange={event => update('descriptionKo', event.target.value)} placeholder="행사 소개와 손님이 알아야 할 내용을 입력하세요." /></label>
                <label className={styles.full}>소개 · 영어<textarea rows={4} maxLength={8000} value={form.descriptionEn} onChange={event => update('descriptionEn', event.target.value)} /></label>
              </div>
            </section>
            <section className={styles.formSection}>
              <h3>날짜와 이용 안내</h3>
              <div className={styles.fields}>
                <label>시작일 *<input type="date" required value={form.startDate} max={form.endDate || undefined} onChange={event => update('startDate', event.target.value)} /></label>
                <label>종료일 *<input type="date" required value={form.endDate} min={form.startDate || undefined} onChange={event => update('endDate', event.target.value)} /></label>
                <label>운영 시간<input maxLength={300} value={form.timeText} onChange={event => update('timeText', event.target.value)} placeholder="예) 10:00–18:00, 입장 마감 17:30" /></label>
                <label>행사 진행 언어<input maxLength={200} value={form.languageText} onChange={event => update('languageText', event.target.value)} placeholder="예) 한국어, 영어 안내 가능" /></label>
                <label>이용 요금<select value={form.feeType} onChange={event => update('feeType', event.target.value as JongnoEventInput['feeType'])}><option value="unknown">확인 필요</option><option value="free">무료</option><option value="paid">유료</option></select></label>
                <label>요금 상세<input maxLength={300} value={form.feeText} onChange={event => update('feeText', event.target.value)} placeholder="예) 성인 10,000원 / 어린이 무료" /></label>
                <label className={`${styles.checkbox} ${styles.full}`}><input type="checkbox" checked={form.bookingRequired} onChange={event => update('bookingRequired', event.target.checked)} /> 사전 예약이 필요한 행사</label>
                <div className={styles.full}><p className={styles.fieldLabel}>정기 휴무</p><div className={styles.weekdays}>{WEEKDAYS.map((day, index) => <label key={day}><input type="checkbox" checked={form.excludedWeekdays.includes(index)} onChange={event => update('excludedWeekdays', event.target.checked ? [...form.excludedWeekdays, index].sort() : form.excludedWeekdays.filter(value => value !== index))} /><span>{day}</span></label>)}</div><p className={styles.help}>선택한 요일에는 캘린더에 행사를 표시하지 않습니다.</p></div>
                <div className={styles.full}><label>별도 휴무일<div className={styles.dateAdd}><input type="date" value={excludedDate} min={form.startDate || undefined} max={form.endDate || undefined} onChange={event => setExcludedDate(event.target.value)} /><button type="button" className={styles.secondary} disabled={!excludedDate || excludedDate < form.startDate || excludedDate > form.endDate || form.excludedDates.includes(excludedDate)} onClick={() => { update('excludedDates', [...form.excludedDates, excludedDate].sort()); setExcludedDate(''); }}>추가</button></div></label><div className={styles.dateChips}>{form.excludedDates.map(date => <button type="button" key={date} onClick={() => update('excludedDates', form.excludedDates.filter(value => value !== date))} aria-label={`${date} 휴무 제외 해제`}>{date}<X size={13} /></button>)}</div></div>
              </div>
            </section>
            <section className={styles.formSection}>
              <h3>사진 <span className={styles.sectionCount}>{form.images.length}/{MAX_IMAGES}</span></h3>
              <p className={styles.help}>JPG·PNG·WebP, 장당 8MB까지. 업로드한 사진은 가볍게 압축되며 첫 번째 사진이 대표 사진입니다.</p>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => void uploadImages(event.target.files)} className={styles.fileInput} aria-label="행사 사진 선택" disabled={busy || form.images.length >= MAX_IMAGES} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || form.images.length >= MAX_IMAGES} className={styles.secondary}>{uploading ? <Loader2 className="animate-spin" size={17} /> : <ImagePlus size={17} />}{uploading ? '사진 업로드 중…' : '사진 추가'}</button>
              <div className={styles.photos}>{form.images.map((image, index) => <div key={`${image.url}-${index}`} className={styles.photoCard}>
                <div className={styles.photoPreview}><Photo image={image} fallback={form.titleKo || '행사 사진'} />{index === 0 && <span>대표 사진</span>}</div>
                <div className={styles.photoFields}>
                  <label>사진 설명<input maxLength={200} value={image.alt} onChange={event => updateImage(index, 'alt', event.target.value)} placeholder="사진 속 장소나 장면" /></label>
                  <label>사진 제공·저작권<input maxLength={200} value={image.credit} onChange={event => updateImage(index, 'credit', event.target.value)} placeholder="예) 직접 촬영 / ○○ 제공" /></label>
                  <label>출처 링크<input type="url" value={image.sourceUrl} onChange={event => updateImage(index, 'sourceUrl', event.target.value)} placeholder="https://" /></label>
                  <div className={styles.photoActions}><button type="button" className={styles.secondary} disabled={index === 0} aria-label={`${index + 1}번 사진 앞으로 이동`} onClick={() => moveImage(index, -1)}><ArrowUp size={15} /> 앞으로</button><button type="button" className={styles.secondary} disabled={index === form.images.length - 1} aria-label={`${index + 1}번 사진 뒤로 이동`} onClick={() => moveImage(index, 1)}><ArrowDown size={15} /> 뒤로</button><button type="button" className={styles.remove} onClick={() => removeImage(index)}>사진 제외</button></div>
                </div>
              </div>)}</div>
              {removedImages.length > 0 && <div className={styles.photoUndo}><p>사진 {removedImages.length}장을 제외했습니다. 저장 전에 되돌릴 수 있습니다.</p><button type="button" className={styles.secondary} onClick={undoRemoveImage} disabled={form.images.length >= MAX_IMAGES}>마지막 제외 취소</button></div>}
            </section>
            <section className={styles.formSection}>
              <h3>공식 안내와 공개 설정</h3>
              <div className={styles.fields}>
                <label className={styles.full}>공식 안내 링크{form.status === 'published' ? ' · 공개 시 필수' : ''}<input type="url" required={form.status === 'published'} maxLength={2000} value={form.officialUrl} onChange={event => update('officialUrl', event.target.value)} placeholder="https://" /></label>
                <label>공식 예약 링크<input type="url" value={form.bookingUrl} onChange={event => update('bookingUrl', event.target.value)} placeholder="https://" /></label>
                <label>지도 링크<input type="url" value={form.mapUrl} onChange={event => update('mapUrl', event.target.value)} placeholder="https://" /></label>
                <label>공개 상태<select value={form.status} onChange={event => update('status', event.target.value as JongnoEventInput['status'])}>{Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <div className={styles.verification}><p className={styles.fieldLabel}>일정 확인</p><button type="button" className={styles.secondary} onClick={() => update('verifiedAt', new Date().toISOString())}><Check size={16} /> 오늘 공식 일정 확인</button><p className={styles.help}>{form.verifiedAt ? `최근 확인: ${new Date(form.verifiedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}` : '공개 전에 행사 주최자의 일정과 예약 안내를 확인해 주세요.'}</p></div>
              </div>
              <p className={styles.help}>임시 저장과 취소·숨김 상태는 손님에게 보이지 않습니다. 종료된 행사는 해당 날짜의 일정에서 제외됩니다.</p>
            </section>
          </fieldset>
          {formError && <div role="alert" className={styles.error}>{formError}{conflict && <button type="button" className={styles.secondary} onClick={() => void reloadEvent()} disabled={busy}>최신 내용 불러오기</button>}</div>}
          {notice && <p role="status" className={styles.success}>{notice}</p>}
          {preview && <section className={styles.preview}><div className={styles.previewHeading}><h3>손님 화면 내용 미리보기</h3><span>저장 전 내용</span></div>{form.images[0] && <div className={styles.previewPhoto}><Photo image={form.images[0]} fallback={form.titleKo || '행사 사진'} /></div>}<p className={styles.eyebrow}>{CATEGORIES[form.category]} · {AREAS[form.area]}</p><h4>{form.titleKo || '행사명'}</h4>{form.titleEn && <p>{form.titleEn}</p>}<p>{form.startDate} ~ {form.endDate} {form.timeText && `· ${form.timeText}`}</p><p>{form.venue} {form.address && `· ${form.address}`}</p><p>{form.feeType === 'free' ? '무료' : form.feeType === 'paid' ? '유료' : '요금 확인 필요'}{form.feeText && ` · ${form.feeText}`}{form.bookingRequired && ' · 사전 예약 필요'}</p><p className={styles.previewText}>{form.descriptionKo || '행사 소개를 입력해 주세요.'}</p>{form.descriptionEn && <p className={styles.previewText}>{form.descriptionEn}</p>}<p className={styles.help}>미리보기는 이 편집 화면에서만 표시됩니다. 공개 여부는 저장한 상태를 따릅니다.</p></section>}
          <footer className={styles.saveBar}><div><p>{dirty ? '저장하지 않은 변경사항이 있습니다.' : selected ? '저장된 내용을 보고 있습니다.' : '입력 후 저장해 주세요.'}</p>{selected && <span>최근 저장 {new Date(selected.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>}</div><div className={styles.saveActions}><button type="button" className={styles.secondary} onClick={() => setPreview(value => !value)}>{preview ? '미리보기 닫기' : '내용 미리보기'}</button><button type="submit" className={styles.primary} disabled={busy || conflict || (!!selected && !dirty)}>{saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}{saving ? '저장 중…' : form.status === 'published' ? '저장하고 공개' : '행사 저장'}</button></div></footer>
        </form>
      </div>}
    </div>
  );
}

function Photo({ image, fallback }: { image: JongnoEventImage; fallback: string }) {
  // Event images are uploaded assets; native img also supports arbitrary storage origins without an image proxy.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={image.url} alt={image.alt || fallback} loading="lazy" />;
}
