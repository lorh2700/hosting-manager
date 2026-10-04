'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Truck, PackageCheck, ShoppingBag, Minus, Plus, Check, ChevronLeft, RefreshCw, CircleAlert, Save } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import LaundryWorkspace from '@/components/LaundryWorkspace';
import { buildRecordPayload, confirmedItems, createRecordDraft, draftStorageKey, hasDraftContent, legacySendReference, LINEN_ITEMS, parseQuantityInput, parseRecordDraft, QUANTITY_LIMIT, quickSendNotes, validateRecordDraft, type RecordDraft, type RecordMode } from '@/lib/operations-records';
import styles from './OperationsRecordWorkspace.module.css';
import { canUseModule, isModuleEnabled } from '@/lib/operational-permissions';

type PropertyChoice = { id: string; name: string; operationalModules?: string[] };
type StockItem = { name: string; quantity: number; checkedAt: string; checkedBy: string };
type InventoryResponse = { properties: PropertyChoice[]; version: number; items: StockItem[]; available: boolean };
type Snapshot = InventoryResponse & { propertyId: string };
type Props = { initialMode?: RecordMode; initialPropertyId?: string; preview?: boolean };

const MODES = [
  { key: 'stock', label: '재고 확인', icon: ClipboardCheck },
  { key: 'send', label: '세탁 보냄', icon: Truck },
  { key: 'receive', label: '세탁 입고', icon: PackageCheck },
  { key: 'supplies', label: '비품 요청', icon: ShoppingBag },
] as const;
const HEADINGS: Record<RecordMode, { title: string; detail: string }> = {
  stock: { title: '현재 깨끗한 재고', detail: '확인한 품목의 현재 총수량만 기록합니다. 세탁 보냄·입고와 재고는 각각 기록합니다.' },
  send: { title: '세탁 보낸 수량', detail: '품목과 보낸 수량만 기록하세요. 기록 시각은 자동으로 남습니다.' },
  receive: { title: '도착한 세탁물 확인', detail: '같은 숙소의 미입고 건을 선택하고, 이번에 실제로 받은 수량을 기록합니다.' },
  supplies: { title: '필요한 비품', detail: '필요한 비품과 요청 사항을 자유롭게 적어 주세요.' },
};
const DEMO_PROPERTIES = [{ id: 'demo-anon', name: '안온재' }, { id: 'demo-hwayeon', name: '화연재' }, { id: 'demo-unwadang', name: '운와당' }];

function checkedTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) : '확인 시각 미상';
}

export default function OperationsRecordWorkspace({ initialMode = 'stock', initialPropertyId = '', preview = false }: Props) {
  const { user, profile, loading: authLoading } = useAuth();
  const accountId = preview ? 'preview-operator' : user?.id || '';
  const [mode, setMode] = useState<RecordMode>(initialMode);
  const [properties, setProperties] = useState<PropertyChoice[]>([]);
  const [propertyId, setPropertyId] = useState(initialPropertyId);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [pickerRefresh, setPickerRefresh] = useState(0);
  const [draft, setDraft] = useState<RecordDraft | null>(null);
  const [draftReadyKey, setDraftReadyKey] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [rawQuantities, setRawQuantities] = useState<Record<number, string>>({});
  const [quantityErrors, setQuantityErrors] = useState<Record<number, string>>({});
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [restoredStock, setRestoredStock] = useState(false);
  const [rechecked, setRechecked] = useState(false);
  const generationRef = useRef(0);
  const scopeKey = accountId && propertyId ? draftStorageKey(accountId, propertyId, mode, preview) : '';
  const activeScopeRef = useRef(scopeKey);
  const propertyName = properties.find(property => property.id === propertyId)?.name || '선택한 숙소';
  const propertyModules = properties.find(property => property.id === propertyId)?.operationalModules;
  const availableModes = MODES.filter(item => {
    if (preview) return true;
    const operationalModule = item.key === 'stock' ? 'inventory' : item.key === 'supplies' ? 'supplies' : 'laundry';
    return !!profile && (profile.role === 'super_admin' || (canUseModule(profile.role, profile.enabledModules, operationalModule) && isModuleEnabled(operationalModule, profile.organizationFeatures) && (!propertyModules || propertyModules.includes(operationalModule))));
  });
  const modeAccessKey = availableModes.map(item => item.key).join(',');
  useEffect(() => { const allowed = modeAccessKey.split(',').filter(Boolean) as RecordMode[]; if (!saving && allowed.length && !allowed.includes(mode)) setMode(allowed[0]); }, [modeAccessKey, mode, saving]);

  const fetchProperties = useCallback(async (signal: AbortSignal): Promise<PropertyChoice[]> => {
    if (preview) return DEMO_PROPERTIES;
    const response = await fetch('/api/properties?work=cleaner', { cache: 'no-store', signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '담당 숙소를 불러오지 못했습니다.');
    return Array.isArray(data) ? data : [];
  }, [preview]);

  const fetchInventory = useCallback(async (selectedId: string, signal: AbortSignal): Promise<InventoryResponse> => {
    if (preview) return {
      properties: DEMO_PROPERTIES, version: 2, available: true,
      items: LINEN_ITEMS.map((name, index) => ({ name, quantity: [1, 6, 4, 2, 8, 6, 6, 2, 4][index], checkedAt: '2026-10-02T00:00:00.000Z', checkedBy: '예시 직원' })),
    };
    const response = await fetch(`/api/inventory${selectedId ? `?propertyId=${encodeURIComponent(selectedId)}` : ''}`, { cache: 'no-store', signal });
    const data: InventoryResponse & { error?: string } = await response.json();
    if (!response.ok) throw new Error(data.error || '숙소와 재고 정보를 불러오지 못했습니다.');
    return data;
  }, [preview]);

  // Account changes discard the visible state before restoring that account's scoped draft.
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++generationRef.current;
    setProperties([]); setSnapshot(null); setPropertyId(initialPropertyId); setMode(initialMode);
    setReview(false); setSavedMessage(''); setError(''); setLoading(true); setLoadError('');
    if (!accountId) { setLoading(false); return; }
    void fetchProperties(controller.signal).then(data => {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setProperties(data);
      const selectedId = data.some(property => property.id === initialPropertyId) ? initialPropertyId : data[0]?.id || '';
      setPropertyId(selectedId);
    }).catch(cause => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : '정보 조회에 실패했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accountId, initialMode, initialPropertyId, fetchProperties, pickerRefresh]);

  useEffect(() => {
    if (!accountId || !propertyId) return;
    if (mode !== 'stock' || !modeAccessKey.split(',').includes('stock')) { setSnapshot(null); setLoading(false); setLoadError(''); return; }
    const controller = new AbortController();
    const generation = generationRef.current;
    setLoading(true); setLoadError('');
    void fetchInventory(propertyId, controller.signal).then(data => {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setSnapshot({ ...data, propertyId });
    }).catch(cause => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : '재고 조회에 실패했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accountId, propertyId, mode, modeAccessKey, refresh, pickerRefresh, fetchInventory]);

  useEffect(() => {
    activeScopeRef.current = scopeKey;
    setReview(false); setError(''); setSavedMessage(''); setRawQuantities({}); setQuantityErrors({}); setConflict(false); setRestoredStock(false); setRechecked(false);
    setDraftNotice(''); setStorageUnavailable(false); setDraftReadyKey('');
    if (!scopeKey || mode === 'receive') { setDraft(null); return; }
    let restored: RecordDraft | null = null;
    try { restored = parseRecordDraft(window.localStorage.getItem(scopeKey), mode); }
    catch { setStorageUnavailable(true); }
    setDraft(restored || createRecordDraft(mode, crypto.randomUUID()));
    if (restored && hasDraftContent(restored)) {
      setDraftNotice('이 계정이 이 숙소에서 작성하던 초안을 불러왔습니다.');
      if (mode === 'stock') setRestoredStock(true);
      if (restored.requiresNewReview) setConflict(true);
      if (restored.attempted) setReview(true);
    }
    setDraftReadyKey(scopeKey);
  }, [scopeKey, mode]);

  useEffect(() => {
    if (!draft || !scopeKey || draftReadyKey !== scopeKey || activeScopeRef.current !== scopeKey) return;
    try {
      if (hasDraftContent(draft)) window.localStorage.setItem(scopeKey, JSON.stringify(draft));
      else window.localStorage.removeItem(scopeKey);
      setStorageUnavailable(false);
    } catch { setStorageUnavailable(true); }
  }, [draft, scopeKey, draftReadyKey]);

  function editDraft(patch: Partial<RecordDraft>) {
    // Do not turn an uncertain submission into a different request under the same id.
    if (draft?.attempted) return;
    setDraft(current => current ? { ...current, ...patch, ...(mode === 'stock' && !current.requiresNewReview ? { baseVersion: undefined } : {}) } : current);
    if (conflict || restoredStock) setRechecked(false);
    setReview(false); setError(''); setSavedMessage(''); setDraftNotice('');
  }
  function updateQuantity(index: number, raw: string) {
    if (!draft) return;
    const parsed = parseQuantityInput(raw);
    setRawQuantities(current => ({ ...current, [index]: raw }));
    setQuantityErrors(current => { const next = { ...current }; if (parsed.error) next[index] = parsed.error; else delete next[index]; return next; });
    editDraft({ items: draft.items.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: parsed.quantity } : row) });
  }
  function editRow(index: number, key: 'name', value: string) {
    if (draft) editDraft({ items: draft.items.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) });
  }
  const checked = draft ? confirmedItems(draft.items) : [];
  const recordItems = mode === 'send' ? checked.filter(row => row.quantity > 0) : checked;
  const requestHasText = !!draft?.requestText.trim();
  const stockReady = !!snapshot && snapshot.propertyId === propertyId && snapshot.available && !loading && !loadError;
  const draftReady = !!draft && draftReadyKey === scopeKey;
  const hasQuantityError = Object.keys(quantityErrors).length > 0;

  function openReview() {
    if (!draft || !draftReady) return;
    if (hasQuantityError) { setError('잘못 입력된 수량을 먼저 확인해 주세요.'); return; }
    const invalid = validateRecordDraft(mode, draft);
    if (invalid) { setError(invalid); return; }
    if (mode === 'stock' && (!stockReady || (conflict || restoredStock) && !rechecked)) { setError('최근 재고 정보를 불러온 뒤 실제 수량을 다시 확인해 주세요.'); return; }
    if (mode === 'stock' && !draft.attempted) {
      setDraft(current => current ? { ...current, baseVersion: snapshot!.version,
        ...(current.requiresNewReview ? { id: crypto.randomUUID(), attempted: false, requiresNewReview: false } : {}) } : current);
    }
    setError(''); setReview(true);
  }

  async function saveRecord() {
    if (!draft || !review || saving || !accountId || mode === 'receive' || !draftReady || hasQuantityError) return;
    if (mode === 'stock' && (!stockReady || (conflict || restoredStock) && !rechecked)) return;
    const currentKey = scopeKey;
    const currentMode = mode;
    const currentName = propertyName;
    const currentCount = recordItems.length;
    let payload;
    try { payload = buildRecordPayload(propertyId, mode, draft, snapshot?.version); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '입력 내용을 확인해 주세요.'); return; }
    setSaving(true); setError('');
    const pendingDraft = { ...draft, attempted: true };
    setDraft(pendingDraft);
    // Persist the exact request before starting fetch, including a tab close during it.
    try { window.localStorage.setItem(currentKey, JSON.stringify(pendingDraft)); } catch { setStorageUnavailable(true); }
    try {
      if (!preview) {
        const endpoint = mode === 'stock' ? '/api/inventory' : mode === 'send' ? '/api/laundry' : '/api/supply-requests';
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data: { error?: string; id?: string; saved?: boolean; version?: number; items?: StockItem[] } = await response.json();
        if (!response.ok) {
          if (response.status === 409 && currentMode === 'stock' && activeScopeRef.current === currentKey) {
            setConflict(true); setRechecked(false); setReview(false); setRefresh(value => value + 1);
            setDraft(current => current ? { ...current, attempted: false, requiresNewReview: true } : current);
          } else if ([400, 401, 403, 404, 422, 503].includes(response.status) && activeScopeRef.current === currentKey) {
            setDraft(current => current && !current.legacySupplyItems && !(currentMode === 'send' && !current.quickSend) ? { ...current, attempted: false } : current);
          }
          throw new Error(data.error || '저장되지 않았습니다. 초안을 유지했습니다.');
        }
        if (data.id !== payload.id || currentMode === 'stock' && data.saved !== true) throw new Error('서버의 저장 결과를 확인하지 못했습니다. 초안을 유지했습니다. 같은 기록으로 다시 확인해 주세요.');
        if (currentMode === 'stock' && activeScopeRef.current === currentKey && data.version !== undefined && data.items) {
          setSnapshot(current => current ? { ...current, version: data.version!, items: data.items! } : current);
        }
      }
      try { window.localStorage.removeItem(currentKey); } catch { /* Saved data is acknowledged even if local storage is unavailable. */ }
      if (activeScopeRef.current !== currentKey) return;
      setSavedMessage(preview ? `테스트 기록 확인 완료 · ${currentName} ${currentMode === 'supplies' ? '비품 요청' : `${currentCount}품목`}. 실제 기록에는 저장되지 않았습니다.` : currentMode === 'supplies' ? `${currentName} 비품 요청이 저장되었습니다.` : `${currentName} ${currentCount}품목 ${currentMode === 'stock' ? '재고 확인' : '세탁 보냄'} 기록이 저장되었습니다.`);
      setReview(false); setDraft(createRecordDraft(currentMode, crypto.randomUUID())); setRawQuantities({}); setQuantityErrors({}); setDraftNotice(''); setConflict(false); setRestoredStock(false); setRechecked(false);
    } catch (cause) {
      if (activeScopeRef.current === currentKey) setError(cause instanceof Error ? cause.message : '저장 결과를 확인하지 못했습니다. 초안을 유지했습니다.');
    } finally { setSaving(false); }
  }

  if (!preview && authLoading) return <div className={styles.workspace} role="status">로그인을 확인하고 있습니다…</div>;
  if (!preview && !user) return <div className={styles.workspace}>로그인 후 빠른 기록을 사용할 수 있습니다.</div>;
  if (!preview && !availableModes.length && !loading) return <div className={styles.workspace}>이 숙소에서 사용할 수 있는 기록 기능이 없습니다. 관리자에게 메뉴 권한을 확인해 주세요.</div>;

  return <div className={styles.workspace}>
    <header className={styles.header}><div><p className={styles.eyebrow}>객실 정비</p><h1>빠른 기록</h1><p className={styles.subtitle}>숙소를 선택하고 확인한 내용만 남겨 주세요.</p></div><span className={styles.draftTag}><Save size={15} aria-hidden="true" />{storageUnavailable ? '이 기기에서 임시 보관 불가' : draft && hasDraftContent(draft) ? '이 기기에 임시 보관 중' : '확인 후 저장'}</span></header>
    {preview && <div className={styles.previewBanner} role="status">테스트 화면 · 실제 기록에 저장되지 않음</div>}
    <section className={styles.context} aria-label="기록할 숙소와 업무">
      <label className={styles.propertyLabel}>숙소<select className={styles.input} value={propertyId} disabled={saving || loading && !properties.length} onChange={event => { setPropertyId(event.target.value); setSnapshot(null); }}><option value="">숙소 선택</option>{properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
      <div className={styles.modes} aria-label="기록 종류">{availableModes.map(({ key, label, icon: Icon }) => <button key={key} type="button" disabled={saving} aria-pressed={mode === key} onClick={() => setMode(key)}><Icon size={21} aria-hidden="true" /><span>{label}</span></button>)}</div>
    </section>
    {loadError && <div role="alert" className={styles.warning}>{loadError}<button type="button" className={styles.secondary} onClick={() => { if (!properties.length) setPickerRefresh(value => value + 1); else setRefresh(value => value + 1); }}><RefreshCw size={16} aria-hidden="true" />다시 불러오기</button></div>}
    {loading && !properties.length && <div role="status" className={styles.loading}>숙소 정보를 불러오는 중…</div>}
    {!loading && !loadError && !properties.length && <p className={styles.empty}>기록할 담당 숙소가 없습니다. 숙소 배정을 확인해 주세요.</p>}
    {!!propertyId && <>
      <section className={styles.heading}><div><h2>{HEADINGS[mode].title}</h2><p>{HEADINGS[mode].detail}</p></div><span className={styles.propertyBadge}>{propertyName}</span></section>
      {mode === 'receive' ? <div className={styles.receive}><LaundryWorkspace embedded receiveOnly propertyId={propertyId} preview={preview} /></div> : draftReady && draft && <>
        {draftNotice && <p className={styles.restored} role="status">{draftNotice}</p>}
        {storageUnavailable && <p className={styles.warning}>이 기기에 초안을 보관할 수 없습니다. 화면을 닫기 전에 내용을 확인하고 저장해 주세요.</p>}
        {savedMessage && <div className={styles.success} role="status"><Check size={21} aria-hidden="true" /><p>{savedMessage}</p></div>}
        {mode === 'stock' && snapshot?.available === false && <div className={styles.warning}><CircleAlert size={19} aria-hidden="true" /><p>재고 기록 저장소를 준비하고 있습니다. 수량은 초안으로 입력할 수 있으며, 준비가 끝나면 저장할 수 있습니다.</p></div>}
        {conflict && <div className={styles.warning}><p>다른 직원이 재고를 변경했습니다. 입력한 초안은 유지했습니다. 새로 불러온 이전 확인값과 실제 수량을 다시 확인해 주세요.</p><label className={styles.checkbox}><input type="checkbox" checked={rechecked} disabled={loading || !stockReady} onChange={event => setRechecked(event.target.checked)} />최근 확인값과 실제 수량을 다시 확인했습니다.</label></div>}
        {restoredStock && !conflict && <div className={styles.warning}><p>복구된 초안의 수량을 다시 확인해 주세요. 이전에 입력한 값은 현재 재고로 자동 확정되지 않습니다.</p><label className={styles.checkbox}><input type="checkbox" checked={rechecked} disabled={loading || !stockReady} onChange={event => setRechecked(event.target.checked)} />초안의 수량이 현재 실제 수량과 같은지 확인했습니다.</label></div>}
        {draft.attempted && <p className={styles.warning}>저장 결과를 확인 중인 기록입니다. 내용과 요청 번호를 유지한 채 다시 확인합니다. 완료 안내가 나오기 전에는 같은 기록을 새로 만들지 마세요.</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {review ? <section className={styles.review} aria-labelledby="operations-record-review-title">
          <div className={styles.reviewHeader}><h3 id="operations-record-review-title">저장하기 전에 확인해 주세요</h3><span>{propertyName}</span></div>
          <p className={styles.reviewKind}>{MODES.find(item => item.key === mode)?.label}{mode !== 'supplies' && ` · ${recordItems.length}품목`}</p>
          {mode === 'supplies' ? <><div className={styles.requestPreview}>{draft.requestText}</div>{draft.legacySupplyItems && <p className={styles.reviewNote}>이전에 품목별로 작성한 기록입니다. 저장 결과가 확인될 때까지 원래 내용으로 다시 확인합니다.</p>}</> : <ul>{recordItems.map(row => <li key={row.name}><span>{row.name}</span><strong>{row.quantity.toLocaleString('ko-KR')}개</strong></li>)}</ul>}
          {mode === 'stock' && <p className={styles.reviewNote}>현재 확인한 총수량입니다. 비워 둔 품목의 기존 기록은 바꾸지 않습니다.</p>}
          {mode === 'send' && (draft.quickSend ? <>
            <p className={styles.reviewNote}>보낸 품목과 수량을 기록합니다. 기록 시각은 자동으로 남습니다.</p>
            {quickSendNotes(draft) && <div className={styles.requestPreview}>{quickSendNotes(draft)}</div>}
          </> : <><p className={styles.reviewNote}>이전에 업체·날짜를 포함해 작성한 기록입니다. 저장 결과가 확인될 때까지 원래 내용으로 다시 확인합니다.</p><dl className={styles.reviewDates}><div><dt>실제로 보낸 날짜</dt><dd>{draft.pickupDate}</dd></div><div><dt>배송 예정일</dt><dd>{draft.deliveryDate}</dd></div><div><dt>세탁업체</dt><dd>{draft.vendor}</dd></div>{draft.vendorPhone && <div><dt>연락처</dt><dd>{draft.vendorPhone}</dd></div>}{draft.notes && <div><dt>메모</dt><dd>{draft.notes}</dd></div>}</dl></>)}
          {mode === 'supplies' && <p className={styles.reviewNote}>긴급도: {draft.urgency === 'urgent' ? '긴급' : '보통'}</p>}
          <div className={styles.reviewActions}><button type="button" className={styles.secondary} disabled={saving || draft.attempted} onClick={() => setReview(false)}><ChevronLeft size={18} aria-hidden="true" />내용 수정</button><button type="button" className={styles.primary} disabled={saving || mode === 'stock' && (!stockReady || (conflict || restoredStock) && !rechecked)} onClick={() => void saveRecord()}>{saving ? '저장 확인 중…' : preview ? '테스트 기록 확인' : draft.attempted ? '같은 기록 다시 확인' : mode === 'supplies' ? '확인한 비품 요청 저장' : '확인한 기록 저장'}</button></div>
        </section> : <>
          {mode === 'supplies' && <div className={styles.urgency}><span>언제 필요한가요?</span><div><button type="button" aria-pressed={draft.urgency === 'normal'} onClick={() => editDraft({ urgency: 'normal' })}>보통</button><button type="button" aria-pressed={draft.urgency === 'urgent'} onClick={() => editDraft({ urgency: 'urgent' })}>긴급</button></div></div>}
          {mode === 'supplies' ? <section className={styles.requestBody} aria-label="비품 요청 내용 입력">
            <label htmlFor="operations-supply-request-text">요청 내용</label>
            <p className={styles.requestHelp}>필요한 비품이나 전달할 내용을 적어 주세요. 카톡 내용을 그대로 붙여 넣어도 됩니다.</p>
            <textarea id="operations-supply-request-text" className={`${styles.input} ${styles.requestInput}`} rows={6} maxLength={2000} value={draft.requestText} placeholder={'예: 생수가 부족해요.\n휴지와 쓰레기봉투도 부탁드립니다.'} onChange={event => editDraft({ requestText: event.target.value })} aria-describedby="operations-supply-text-length" />
            <p id="operations-supply-text-length" className={styles.requestLength}>{draft.requestText.length.toLocaleString('ko-KR')} / 2,000자</p>
          </section> :
          <section className={styles.items} aria-label="품목별 수량 입력">
            <div className={styles.sectionTitle}><h3>{mode === 'stock' ? '현재 총수량' : '실제로 보낸 수량'}</h3><span>{checked.length} / {draft.items.length}품목 입력</span></div>
            {mode === 'stock' && <p className={styles.helper}>지금 확인한 총수량을 입력하세요. 빈칸은 미확인, 0은 실제로 없는 수량입니다.</p>}
            {draft.items.map((row, index) => {
              const previous = snapshot?.propertyId === propertyId ? snapshot.items.find(item => item.name === row.name) : undefined;
              const custom = index >= LINEN_ITEMS.length;
              const value = rawQuantities[index] ?? (row.quantity === null ? '' : String(row.quantity));
              return <div key={index} className={`${styles.item} ${row.quantity !== null && !quantityErrors[index] ? styles.checkedItem : ''}`}>
                <div className={styles.itemName}>{custom ? <input className={styles.nameInput} value={row.name} maxLength={60} aria-label={`추가 품목 ${index + 1} 이름`} placeholder="품목 이름" onChange={event => editRow(index, 'name', event.target.value)} /> : <h4>{row.name}</h4>}{mode === 'stock' && <p>{previous ? <>이전 <strong>{previous.quantity}개</strong><small>{checkedTime(previous.checkedAt)} · {previous.checkedBy}</small></> : '이전 확인 기록 없음'}</p>}</div>
                <div className={styles.quantity}><button type="button" disabled={row.quantity === 0} aria-label={`${row.name || '추가 품목'} 수량 줄이기`} onClick={() => updateQuantity(index, String(Math.max(0, (row.quantity ?? 1) - 1)))}><Minus size={19} aria-hidden="true" /></button><input inputMode="numeric" aria-label={`${row.name || '추가 품목'} ${mode === 'stock' ? '현재 총' : mode === 'send' ? '보낸' : '필요한'} 수량`} aria-invalid={!!quantityErrors[index]} aria-describedby={quantityErrors[index] ? `operations-quantity-error-${index}` : undefined} value={value} placeholder="미확인" maxLength={6} onChange={event => updateQuantity(index, event.target.value)} /><button type="button" disabled={row.quantity === QUANTITY_LIMIT} aria-label={`${row.name || '추가 품목'} 수량 늘리기`} onClick={() => updateQuantity(index, String(Math.min(QUANTITY_LIMIT, (row.quantity ?? 0) + 1)))}><Plus size={19} aria-hidden="true" /></button></div>
                {quantityErrors[index] && <p id={`operations-quantity-error-${index}`} className={styles.quantityError}>{quantityErrors[index]}</p>}
                {row.quantity !== null && <button className={styles.clearQuantity} type="button" onClick={() => updateQuantity(index, '')}>입력 비우기</button>}
              </div>;
            })}
            <button type="button" className={styles.addItem} disabled={draft.items.length >= 30} onClick={() => editDraft({ items: [...draft.items, { name: '', quantity: null }] })}><Plus size={19} aria-hidden="true" />다른 품목 추가</button>
          </section>}
          {mode === 'send' && <details className={styles.sendNotes}>
            <summary>메모 추가 (선택)</summary>
            <label htmlFor="operations-send-notes">전달할 내용<textarea id="operations-send-notes" className={styles.input} maxLength={2000} rows={3} value={draft.notes} placeholder="전달 장소나 참고할 내용이 있을 때만 입력하세요." onChange={event => editDraft({ notes: event.target.value })} /></label>
          </details>}
          {mode === 'send' && draft.quickSend && legacySendReference(draft) && <details className={styles.sendNotes}><summary>이전 초안의 입력 정보</summary><p className={styles.helper}>이전에 입력한 정보는 참고 메모로 함께 보관합니다. 업체·배송 일정으로 자동 확정하지 않습니다.</p><div className={styles.requestPreview}>{legacySendReference(draft)}</div></details>}
          <div className={styles.actionBar}><div><strong>{mode === 'supplies' ? requestHasText ? '요청 내용 입력됨' : '비품 요청' : `${recordItems.length}품목 ${mode === 'stock' ? '확인' : '입력'}`}</strong><small>{storageUnavailable ? '화면을 닫으면 초안이 사라질 수 있습니다.' : '미제출 초안은 이 기기에 임시 보관됩니다.'}</small></div><button type="button" className={styles.primary} disabled={mode === 'supplies' ? !requestHasText : !(mode === 'send' ? recordItems.length : checked.length) || hasQuantityError || mode === 'stock' && (!stockReady || (conflict || restoredStock) && !rechecked)} onClick={openReview}>내용 확인<Check size={18} aria-hidden="true" /></button></div>
        </>}
      </>}
    </>}
  </div>;
}
