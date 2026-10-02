'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRefetchOnReturn } from '@/lib/hooks/useRefetchOnReturn';
import {
  LAUNDRY_LABELS, createLaundry, isLaundryAwaitingReceipt, laundryItems,
  laundryStatus, receiveLaundry, type LaundryCreation, type LaundryItem,
} from '@/lib/laundry';
import { isLaundryDue, isLaundryOverdue, isLaundryRecordedToday, laundryPickupDateLabel } from '@/lib/laundry-view';

type Schedule = { pickupDate: string; deliveryDate: string; vendor: string; vendorPhone: string; notes: string };
type History = { at: string; actor: string; action: string; note?: string; request?: { quickSend?: boolean }; schedule?: Partial<Schedule> };
type Batch = Schedule & { id: string; propertyId: string; property: { name: string }; status: string; items: LaundryItem[]; version: number; history: History[] };
type Incoming = { name: string; quantity: number; damaged: number; rewash: number };
type Update = {
  id: string; version: number; action: 'receive' | 'correct' | 'collect' | 'washing' | 'shipping' | 'cancel' | 'schedule';
  incoming?: Incoming[]; items?: LaundryItem[]; note?: string; schedule?: Schedule;
};
type Creation = Omit<LaundryCreation, 'collected'> & { collected?: boolean };
export interface LaundryWorkspaceProps { embedded?: boolean; receiveOnly?: boolean; propertyId?: string; preview?: boolean }

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const fresh = (): LaundryItem[] => ['수건', '시트', '이불 커버', '베개 커버'].map(name => ({ name, sent: 0, received: 0, damaged: 0, rewash: 0 }));
const control = 'min-h-11 rounded-xl border border-stone-300 bg-white px-3 py-2 w-full text-base';
const button = 'min-h-11 rounded-xl border border-stone-300 px-4 py-2 disabled:opacity-40';
const previewNames: Record<string, string> = { 'demo-anon': '안온재', 'demo-hwayeon': '화연재', 'demo-unwadang': '운와당' };
function previewBatch(propertyId: string): Batch {
  const items = [
    { name: '이불커버', sent: 5, received: 2 }, { name: '매트', sent: 4, received: 1 },
    { name: '베개', sent: 7, received: 2 }, { name: '대형수건', sent: 7, received: 2 },
    { name: '작은수건', sent: 3, received: 1 }, { name: '발매트', sent: 2, received: 1 },
  ].map(item => ({ ...item, damaged: 0, rewash: 0 }));
  return {
    id: '18aa9e72-4728-4a64-bb38-d77d4a74dd02', propertyId, property: { name: previewNames[propertyId] || '미리보기 숙소' },
    pickupDate: today(), deliveryDate: '', vendor: '', vendorPhone: '', notes: '입고 화면 확인용 예시입니다.',
    status: 'partial', items, version: 1, history: [{ at: new Date().toISOString(), actor: '미리보기', action: '보냄 기록', request: { quickSend: true } }],
  };
}

function Counter({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  return <div className="flex items-center gap-1 shrink-0">
    <button type="button" className={button} aria-label={label + ' 줄이기'} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
    <input aria-label={label} type="number" min="0" max="10000" step="1" inputMode="numeric" className="w-16 min-h-11 text-center border rounded-lg" style={{ fontSize: 16 }} value={value}
      onChange={event => onChange(Math.max(0, Math.min(10000, Number(event.target.value) || 0)))} />
    <button type="button" className={button} aria-label={label + ' 늘리기'} onClick={() => onChange(Math.min(10000, value + 1))}>+</button>
  </div>;
}

export default function LaundryWorkspace({ embedded = false, receiveOnly = false, propertyId: scopedPropertyId, preview = false }: LaundryWorkspaceProps) {
  const [rows, setRows] = useState<Batch[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState(''), [tab, setTab] = useState(embedded ? 'due' : 'pending'), [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Batch | null>(null), [form, setForm] = useState(false), [requestId, setRequestId] = useState('');
  const [selectedPropertyId, setSelectedPropertyId] = useState(''), [pickupDate, setPickup] = useState(today), [deliveryDate, setDelivery] = useState(today);
  const [vendor, setVendor] = useState(''), [vendorPhone, setPhone] = useState(''), [notes, setNotes] = useState(''), [items, setItems] = useState(fresh);
  const [selected, setSelected] = useState<Batch | null>(null), [mode, setMode] = useState<'receive' | 'correct'>('receive');
  const [quantities, setQuantities] = useState<LaundryItem[]>([]), [note, setNote] = useState('');
  const loadSequence = useRef(0);
  const currentScope = useRef(scopedPropertyId);
  useEffect(() => { currentScope.current = scopedPropertyId; }, [scopedPropertyId]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setError('');
    try {
      if (preview) {
        const example = previewBatch(scopedPropertyId || 'preview-property');
        setRows([example]);
        setProperties([{ id: example.propertyId, name: example.property.name }]);
        setSelectedPropertyId(example.propertyId);
        return;
      }
      const endpoint = scopedPropertyId ? '/api/laundry?propertyId=' + encodeURIComponent(scopedPropertyId) : '/api/laundry';
      const response = await fetch(endpoint, { cache: 'no-store' });
      const data = await response.json();
      if (sequence !== loadSequence.current) return;
      if (!response.ok) throw Error(data.error || '세탁 정보를 불러오지 못했습니다.');
      if (!Array.isArray(data.batches) || !Array.isArray(data.properties)) throw Error('세탁 목록을 확인하지 못했습니다. 다시 불러와주세요.');
      setRows(data.batches); setProperties(data.properties);
      setSelectedPropertyId(id => scopedPropertyId || id || data.properties[0]?.id || '');
    } catch (caught) {
      if (sequence === loadSequence.current) setError(caught instanceof Error ? caught.message : '세탁 정보를 불러오지 못했습니다.');
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [preview, scopedPropertyId]);
  const invalidateLoads = useCallback(() => { loadSequence.current++; }, []);

  useEffect(() => {
    setLoading(true); setRows([]); setSelected(null); setNotice('');
    void load();
    return invalidateLoads;
  }, [load, invalidateLoads]);
  useRefetchOnReturn(load, { enabled: !preview && !form && !selected && !busy });

  function simulate(payload: Update | Creation, method: 'PATCH' | 'POST') {
    if (method === 'POST') {
      const parsed = createLaundry.parse(payload);
      const example = previewBatch(parsed.propertyId);
      const batch: Batch = { ...example, ...parsed, status: parsed.collected ? 'collected' : 'scheduled', history: [], version: 1 };
      setRows(previous => [batch, ...previous]);
      return;
    }
    const input = payload as Update;
    const batch = rows.find(row => row.id === input.id);
    if (!batch || batch.version !== input.version) throw Error('기록을 다시 확인해주세요.');
    let changed = { ...batch, version: batch.version + 1 };
    if (input.action === 'receive') {
      const received = receiveLaundry(batch.items, input.incoming || []);
      changed = { ...changed, items: received, status: laundryStatus(received) };
    } else if (input.action === 'correct') {
      if (!input.note?.trim()) throw Error('정정 사유를 입력해주세요.');
      const corrected = laundryItems.parse(input.items);
      changed = { ...changed, items: corrected, status: batch.status === 'scheduled' ? 'scheduled' : laundryStatus(corrected) };
    } else if (input.action === 'schedule') changed = { ...changed, ...input.schedule };
    else changed.status = input.action === 'collect' ? 'collected' : input.action === 'cancel' ? 'cancelled' : input.action;
    changed.history = [...changed.history, { at: new Date().toISOString(), actor: '미리보기', action: input.action, note: input.note }];
    setRows(previous => previous.map(row => row.id === changed.id ? changed : row));
  }

  async function mutate(payload: Update | Creation, method: 'PATCH' | 'POST' = 'PATCH') {
    const requestScope = scopedPropertyId;
    setBusy(true); setError(''); setNotice('');
    try {
      if (preview) {
        simulate(payload, method);
        setNotice('테스트 화면에 반영했습니다. 실제 데이터는 저장되지 않았습니다.');
      } else {
        const response = await fetch('/api/laundry', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await response.json();
        if (currentScope.current !== requestScope) return;
        if (!response.ok) throw Error(data.error || '저장하지 못했습니다.');
        setRows(previous => previous.map(row => row.id === data.id ? { ...row, ...data } : row));
        setNotice('세탁 기록을 저장했습니다.');
        await load();
      }
      setSelected(null); setForm(false);
    } catch (caught) { if (currentScope.current === requestScope) setError(caught instanceof Error ? caught.message : '입력값을 확인해주세요.'); }
    finally { setBusy(false); }
  }

  function openReceive(row: Batch, correct = false) {
    setSelected(row); setMode(correct ? 'correct' : 'receive'); setNote(''); setError(''); setNotice('');
    setQuantities(row.items.map(item => correct ? { ...item } : { ...item, received: 0, damaged: 0, rewash: 0 }));
  }
  function edit(index: number, key: keyof Omit<LaundryItem, 'name'>, value: number) {
    setQuantities(previous => previous.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  }
  const todayDate = today();
  const visible = rows.filter(row => (!scopedPropertyId || row.propertyId === scopedPropertyId) && (scopedPropertyId || !filter || row.propertyId === filter) && (
    receiveOnly ? isLaundryAwaitingReceipt(row.status) :
      tab === 'all' || tab === 'due' && isLaundryDue(row, todayDate) ||
      tab === 'today' && isLaundryRecordedToday(row, todayDate) ||
      tab === 'pending' && !['completed', 'cancelled'].includes(row.status) ||
      tab === 'attention' && (row.items.some(item => item.damaged + item.rewash > 0) || isLaundryOverdue(row, todayDate))
  ));
  const receiptReady = mode === 'correct' || quantities.some(item => item.received > 0);
  const receiptForm = selected && <form aria-label="세탁물 입고 및 수량 정정" className={embedded && receiveOnly ? 'space-y-4' : 'bg-white rounded-2xl max-w-xl mx-auto p-5 space-y-4'}
    onSubmit={event => { event.preventDefault(); void mutate({ id: selected.id, version: selected.version, action: mode, note,
      ...(mode === 'correct' ? { items: quantities } : { incoming: quantities.map(item => ({ name: item.name, quantity: item.received, damaged: item.damaged, rewash: item.rewash })) }) }); }}>
    <h2 className="text-xl font-semibold">{selected.property.name} · {mode === 'receive' ? '입고 확인' : '수량 정정'}</h2>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {mode === 'receive' && <>
      <p className="text-sm text-stone-600">이번에 실제로 받은 수량만 입력하세요. 이전 입고 수량에 더해 세탁 미입고 수량을 갱신합니다.</p>
      <button type="button" className={button} onClick={() => setQuantities(previous => previous.map((item, index) => ({ ...item,
        received: selected.items[index].sent - selected.items[index].received, damaged: 0, rewash: 0 })))}>남은 수량 전량 입고</button>
    </>}
    {quantities.map((item, index) => <fieldset key={item.name} className="border rounded-xl p-3 space-y-3">
      <legend>{item.name} · 미입고 {selected.items[index].sent - selected.items[index].received}</legend>
      {(mode === 'correct' ? ['sent', 'received', 'damaged', 'rewash'] as const : ['received', 'damaged', 'rewash'] as const).map(key => <div key={key} className="flex flex-wrap items-center justify-between gap-2">
        <span>{key === 'sent' ? '보낸 총수량' : key === 'received' ? mode === 'correct' ? '누적 입고' : '이번 입고' : key === 'damaged' ? '그중 파손' : '그중 재세탁'}</span>
        <Counter label={item.name + ' ' + (key === 'received' ? mode === 'correct' ? '누적 입고 수량' : '이번 입고 수량' : key)} value={item[key]} onChange={value => edit(index, key, value)} />
      </div>)}
    </fieldset>)}
    <label className="block">{mode === 'correct' ? '정정 사유 (필수)' : '배송·오염·파손 메모'}<textarea required={mode === 'correct'} maxLength={2000} className={control} value={note} onChange={event => setNote(event.target.value)} /></label>
    <div className="flex gap-2"><button disabled={busy || !receiptReady} className={button + ' bg-stone-900 text-white'}>{busy ? '저장 중…' : '확인 후 저장'}</button>
      <button type="button" disabled={busy} className={button} onClick={() => { setSelected(null); setError(''); }}>닫기</button></div>
  </form>;

  return <div className="space-y-5">
    {!(embedded && receiveOnly) && <header className="flex justify-between gap-3 items-center"><div>
      <h2 className="text-xl font-semibold">{receiveOnly ? '세탁물 입고 확인' : embedded ? '오늘 세탁 · 수거와 입고' : '세탁 관리'}</h2>
      <p className="text-sm text-stone-500 mt-1">{receiveOnly ? '이미 보낸 세탁물 중 입고 대기 건을 확인하세요.' : embedded ? '오늘 처리할 일정과 기한이 지난 세탁물을 함께 확인하세요.' : '지점별 수거부터 입고 확인까지'}</p>
    </div>{!receiveOnly && <button className={button + ' bg-stone-900 text-white'} onClick={() => {
      setEditing(null); setForm(true); setRequestId(crypto.randomUUID()); setItems(fresh()); setPickup(today()); setDelivery(today()); setNotes(''); setError('');
    }}>수거 등록</button>}</header>}
    {preview && !(embedded && receiveOnly) && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">미리보기 · 예시 데이터입니다. 실제 조회·저장은 하지 않습니다.</p>}
    {receiveOnly && <p className="text-sm text-stone-600">세탁 입고는 현재 재고와 별도로 기록합니다.</p>}
    {!receiveOnly && <div className="flex gap-2 flex-wrap">{[...(embedded ? [['due', '오늘 할 일']] : []), ['pending', '진행 중'], ['today', '오늘 기록·일정'], ['attention', '확인 필요'], ['all', '전체']].map(([key, label]) =>
      <button key={key} className={button + (tab === key ? ' bg-stone-200' : '')} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>}
    {!scopedPropertyId && <label className="block text-sm">숙소<select className={control} value={filter} onChange={event => setFilter(event.target.value)}><option value="">전체 담당 숙소</option>{properties.map(property => <option value={property.id} key={property.id}>{property.name}</option>)}</select></label>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 text-emerald-800 p-3 text-sm">{notice}</p>}
    {error && !selected && <div role="alert" className="rounded-xl bg-red-50 text-red-800 p-4">{error}<button className={button + ' ml-2'} disabled={busy} onClick={() => void load()}>새로고침</button></div>}
    {receiveOnly && selected ? receiptForm : loading ? <p role="status">세탁 정보를 불러오는 중…</p> : !visible.length ?
      <p className="p-8 text-center text-stone-500">{receiveOnly ? '현재 입고 대기 중인 세탁물이 없습니다.' : tab === 'due' ? '오늘 처리할 날짜가 정해진 세탁 일정이 없습니다. 예정일이 없는 세탁물은 진행 중에서 확인하세요.' : '표시할 세탁 건이 없습니다.'}</p> :
      visible.map(row => <article className="bg-white rounded-2xl border p-4 space-y-3" key={row.id}>
        <div className="flex justify-between gap-2"><strong>{row.property.name}</strong><span>{LAUNDRY_LABELS[row.status] || row.status}</span></div>
        <p className="text-sm">{laundryPickupDateLabel(row)} {row.pickupDate || '미정'} · {row.deliveryDate ? `배송 예정 ${row.deliveryDate}` : '배송 예정일 미정'}</p>
        {(row.vendor || row.vendorPhone) && <p className="text-sm text-stone-600">{row.vendor} {row.vendorPhone}</p>}
        {row.notes && <p className="text-sm whitespace-pre-wrap">{row.notes}</p>}
        <table className="w-full text-sm text-right"><thead><tr><th className="text-left">품목</th><th>보냄</th><th>입고</th><th>미입고</th></tr></thead><tbody>{row.items.map(item => <tr key={item.name} className="border-t">
          <td className="text-left py-2">{item.name}{item.damaged + item.rewash > 0 && <span className="block text-xs text-red-700">파손 {item.damaged} · 재세탁 {item.rewash}</span>}</td>
          <td>{item.sent}</td><td>{item.received}</td><td className={item.sent > item.received ? 'text-amber-700 font-semibold' : ''}>{item.sent - item.received}</td>
        </tr>)}</tbody></table>
        {isLaundryOverdue(row, todayDate) && <p className="text-red-700 text-sm">배송 예정일이 지났습니다.</p>}
        {receiveOnly ? <button disabled={busy} className={button + ' w-full min-h-12 bg-stone-900 text-white font-semibold'} onClick={() => openReceive(row)}>이 세탁물 입고 확인</button> : <div className="flex gap-2 flex-wrap">
          {!['completed', 'cancelled'].includes(row.status) && <button className={button} disabled={busy} onClick={() => {
            setEditing(row); setForm(true); setSelectedPropertyId(row.propertyId); setPickup(row.pickupDate); setDelivery(row.deliveryDate); setVendor(row.vendor); setPhone(row.vendorPhone); setNotes(row.notes); setItems(row.items); setError('');
          }}>일정·배송 수정</button>}
          {row.status === 'scheduled' ? <><button disabled={busy} className={button} onClick={() => void mutate({ id: row.id, version: row.version, action: 'collect' })}>수거 완료</button>
            <button disabled={busy} className={button} onClick={() => { const reason = window.prompt('취소 사유'); if (reason?.trim()) void mutate({ id: row.id, version: row.version, action: 'cancel', note: reason }); }}>일정 취소</button></> :
            isLaundryAwaitingReceipt(row.status) && <><button disabled={busy} className={button + ' bg-stone-900 text-white'} onClick={() => openReceive(row)}>입고 확인</button>
              {(['washing', 'shipping'] as const).map(action => <button disabled={busy || row.status === action} key={action} className={button} onClick={() => void mutate({ id: row.id, version: row.version, action })}>{LAUNDRY_LABELS[action]}</button>)}</>}
          {row.status !== 'cancelled' && <button className={button} onClick={() => openReceive(row, true)}>수량 정정</button>}
        </div>}
        {!receiveOnly && <details className="text-xs text-stone-500"><summary className="cursor-pointer py-2">작업 이력</summary>{row.history.map((history, index) => <p key={index} className="py-1">
          {new Date(history.at).toLocaleString('ko-KR')} · {history.actor} · {({ collect: '수거 완료', washing: '세탁 중', shipping: '배송 중', receive: '입고 확인', correct: '수량 정정', cancel: '취소', schedule: '일정·배송 수정' } as Record<string, string>)[history.action] || history.action} {history.note}
        </p>)}</details>}
      </article>)}
    {!selected && <p className="text-xs text-stone-500">{receiveOnly ? '최근 수거 기록 최대 300개 중 입고 대기 건을 표시합니다.' : '최근 수거 건 최대 300개를 표시합니다.'} 파손·재세탁 수량은 입고 수량에 포함되며 별도로 표시됩니다.</p>}
    {form && !receiveOnly && <div className="fixed inset-0 z-[60] bg-black/40 overflow-y-auto p-3"><form role="dialog" aria-modal="true" aria-label="수거 등록" className="bg-white rounded-2xl max-w-xl mx-auto p-5 space-y-4"
      onSubmit={event => { event.preventDefault(); if (editing) void mutate({ id: editing.id, version: editing.version, action: 'schedule', schedule: { pickupDate, deliveryDate, vendor, vendorPhone, notes } });
        else void mutate({ id: requestId, propertyId: selectedPropertyId, pickupDate, deliveryDate, vendor, vendorPhone, notes, items: items.filter(item => item.sent > 0) }, 'POST'); }}>
      <h2 className="text-xl">{editing ? '세탁 일정·배송 수정' : '세탁물 수거 등록'}</h2>{error && <p role="alert" className="text-red-700">{error}</p>}
      <label className="block">숙소<select disabled={Boolean(editing || scopedPropertyId)} required className={control} value={selectedPropertyId} onChange={event => setSelectedPropertyId(event.target.value)}>{properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-3"><label>수거 예정일<input required type="date" className={control} value={pickupDate} onChange={event => setPickup(event.target.value)} /></label>
        <label>배송 예정일<input required type="date" min={pickupDate} className={control} value={deliveryDate} onChange={event => setDelivery(event.target.value)} /></label></div>
      <label className="block">세탁업체<input required maxLength={100} className={control} value={vendor} onChange={event => setVendor(event.target.value)} /></label>
      <label className="block">업체·기사 연락처<input type="tel" maxLength={40} className={control} value={vendorPhone} onChange={event => setPhone(event.target.value)} /></label>
      {!editing && items.map((item, index) => <div key={index} className="flex justify-between items-center gap-2"><input aria-label={'품목 ' + (index + 1)} className={control + ' max-w-40'} value={item.name} maxLength={60} onChange={event => setItems(previous => previous.map((value, itemIndex) => itemIndex === index ? { ...value, name: event.target.value } : value))} />
        <Counter label={item.name + ' 보낼 수량'} value={item.sent} onChange={value => setItems(previous => previous.map((entry, itemIndex) => itemIndex === index ? { ...entry, sent: value } : entry))} /></div>)}
      {!editing && <button type="button" className={button} disabled={items.length >= 30} onClick={() => setItems(previous => [...previous, { name: '', sent: 0, received: 0, damaged: 0, rewash: 0 }])}>품목 추가</button>}
      <label className="block">전달 장소·메모<textarea maxLength={2000} className={control} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      <div className="flex gap-2"><button disabled={busy} className={button + ' bg-stone-900 text-white'}>{busy ? '저장 중…' : editing ? '일정 저장' : '수거 예정 저장'}</button><button type="button" disabled={busy} className={button} onClick={() => { setForm(false); setError(''); }}>닫기</button></div>
    </form></div>}
    {selected && !receiveOnly && <div role="dialog" aria-modal="true" aria-label="입고 및 정정" className="fixed inset-0 z-[60] bg-black/40 overflow-y-auto p-3">{receiptForm}</div>}
  </div>;
}
