export type RecordMode = 'stock' | 'send' | 'receive' | 'supplies';
export type QuantityRow = { name: string; quantity: number | null; unit?: string };
export type LegacySupplyItem = { name: string; quantity: number; unit?: string };
export type RecordDraft = {
  id: string;
  items: QuantityRow[];
  requestText: string;
  /** An uncertain structured request must retain its original payload under its UUID. */
  legacySupplyItems?: LegacySupplyItem[];
  /** New send records contain quantities only; legacy uncertain sends retain their detail payload. */
  quickSend?: boolean;
  pickupDate: string;
  deliveryDate: string;
  vendor: string;
  vendorPhone: string;
  notes: string;
  urgency: 'normal' | 'urgent';
  /** Pin the submitted inventory version so a retry has the exact same request hash. */
  baseVersion?: number;
  attempted?: boolean;
  requiresNewReview?: boolean;
};

export const LINEN_ITEMS = ['손수건', '대형수건', '작은수건', '발수건', '베개커버', '이불커버', '매트커버', '방수커버', '쿠션커버'] as const;
export const SUPPLY_ITEMS = ['생수', '휴지', '쓰레기봉투'] as const;
export const QUANTITY_LIMIT = 10000;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function draftStorageKey(userId: string, propertyId: string, mode: RecordMode, preview = false): string {
  if (!userId || !propertyId) throw new Error('초안의 계정과 숙소가 필요합니다.');
  return `void-operations:v1:${encodeURIComponent(JSON.stringify([preview ? 'preview' : 'live', userId, propertyId, mode]))}`;
}

export function createRecordDraft(mode: RecordMode, id: string): RecordDraft {
  return {
    id,
    items: mode === 'supplies' ? [] : LINEN_ITEMS.map(name => ({ name, quantity: null })),
    requestText: '',
    ...(mode === 'send' ? { quickSend: true } : {}),
    pickupDate: '', deliveryDate: '', vendor: '', vendorPhone: '', notes: '', urgency: 'normal',
  };
}

export function parseRecordDraft(raw: string | null, mode: RecordMode): RecordDraft | null {
  if (!raw || raw.length > 25000) return null;
  try {
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const value = input as Record<string, unknown>;
    if (typeof value.id !== 'string' || !uuid.test(value.id) || !Array.isArray(value.items) || mode !== 'supplies' && value.items.length < 1 || value.items.length > 30) return null;
    const items: QuantityRow[] = [];
    for (const item of value.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const row = item as Record<string, unknown>;
      if (typeof row.name !== 'string' || row.name.length > 60 || !(row.quantity === null || typeof row.quantity === 'number' && Number.isInteger(row.quantity) && row.quantity >= 0 && row.quantity <= QUANTITY_LIMIT)) return null;
      if (row.unit !== undefined && (typeof row.unit !== 'string' || row.unit.length > 20)) return null;
      items.push({ name: row.name, quantity: row.quantity as number | null, ...(mode === 'supplies' ? { unit: typeof row.unit === 'string' ? row.unit : '' } : {}) });
    }
    for (const key of ['pickupDate', 'deliveryDate', 'vendor', 'vendorPhone', 'notes']) if (typeof value[key] !== 'string') return null;
    if ((value.pickupDate as string).length > 10 || (value.deliveryDate as string).length > 10 || (value.vendor as string).length > 100 || (value.vendorPhone as string).length > 40 || (value.notes as string).length > 2000) return null;
    if (!['normal', 'urgent'].includes(String(value.urgency))) return null;
    if (value.baseVersion !== undefined && (typeof value.baseVersion !== 'number' || !Number.isInteger(value.baseVersion) || value.baseVersion < 0 || value.baseVersion > 2147483646)) return null;
    if (value.attempted !== undefined && typeof value.attempted !== 'boolean' || value.requiresNewReview !== undefined && typeof value.requiresNewReview !== 'boolean') return null;
    if (value.quickSend !== undefined && typeof value.quickSend !== 'boolean') return null;
    if (value.requestText !== undefined && (typeof value.requestText !== 'string' || value.requestText.length > 10000)) return null;
    let legacySupplyItems: LegacySupplyItem[] | undefined;
    if (value.legacySupplyItems !== undefined) {
      if (mode !== 'supplies' || value.attempted !== true || !Array.isArray(value.legacySupplyItems) || !value.legacySupplyItems.length || value.legacySupplyItems.length > 30) return null;
      legacySupplyItems = [];
      for (const candidate of value.legacySupplyItems) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
        const row = candidate as Record<string, unknown>;
        if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 60 || typeof row.quantity !== 'number' || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > QUANTITY_LIMIT) return null;
        if (row.unit !== undefined && (typeof row.unit !== 'string' || !row.unit.trim() || row.unit.length > 20)) return null;
        legacySupplyItems.push({ name: row.name, quantity: row.quantity, ...(row.unit !== undefined ? { unit: row.unit as string } : {}) });
      }
    } else if (mode === 'supplies' && value.attempted === true && value.requestText === undefined) {
      // The previous UI submitted these exact confirmed items, not its unconfirmed rows.
      legacySupplyItems = confirmedItems(items);
    }
    const requestText = legacySupplyItems ? supplyRowsToText(legacySupplyItems)
      : typeof value.requestText === 'string' ? value.requestText : mode === 'supplies' ? supplyRowsToText(items) : '';
    return { id: value.id, items: mode === 'supplies' ? [] : items, requestText,
      ...(legacySupplyItems ? { legacySupplyItems } : {}), pickupDate: value.pickupDate as string, deliveryDate: value.deliveryDate as string, vendor: value.vendor as string,
      vendorPhone: value.vendorPhone as string, notes: value.notes as string, urgency: value.urgency as 'normal' | 'urgent',
      ...(mode === 'send' ? { quickSend: value.quickSend === true || value.quickSend === undefined && value.attempted !== true } : {}),
      ...(value.baseVersion !== undefined ? { baseVersion: value.baseVersion as number } : {}),
      ...(value.attempted !== undefined ? { attempted: value.attempted as boolean } : {}),
      ...(value.requiresNewReview !== undefined ? { requiresNewReview: value.requiresNewReview as boolean } : {}) };
  } catch { return null; }
}

/** Preserve meaningful old input without inventing a quantity for an unchecked item. */
export function supplyRowsToText(items: QuantityRow[]): string {
  return items.filter((row, index) => row.name.trim() && (row.quantity !== null || row.unit?.trim() || index >= SUPPLY_ITEMS.length || !SUPPLY_ITEMS.includes(row.name.trim() as typeof SUPPLY_ITEMS[number])))
    .map(row => row.quantity === null ? `${row.name.trim()}${row.unit?.trim() ? ` · 단위: ${row.unit.trim()}` : ''} (수량 미확인)`
      : `${row.name.trim()} ${row.quantity}${row.unit?.trim() ? ` ${row.unit.trim()}` : ''}`).join('\n');
}

export const normalizedRequestText = (text: string): string => text.replace(/\r\n/g, '\n').trim();

/** Old, unsubmitted schedule input remains a reference, not confirmed schedule fields. */
export function legacySendReference(draft: Pick<RecordDraft, 'vendor' | 'pickupDate' | 'deliveryDate' | 'vendorPhone'>): string {
  const lines = [
    draft.vendor ? `세탁업체 입력값: ${draft.vendor}` : '',
    draft.pickupDate ? `보낸 날짜 입력값: ${draft.pickupDate}` : '',
    draft.deliveryDate ? `배송 예정일 입력값: ${draft.deliveryDate}` : '',
    draft.vendorPhone ? `업체 연락처 입력값: ${draft.vendorPhone}` : '',
  ].filter(Boolean);
  return lines.length ? `이전 초안 참고 정보 (일정 확정 아님)\n${lines.join('\n')}` : '';
}

export function quickSendNotes(draft: RecordDraft): string {
  const reference = legacySendReference(draft);
  return reference ? `${draft.notes}${draft.notes ? '\n\n' : ''}${reference}` : draft.notes;
}

export function parseQuantityInput(raw: string): { quantity: number | null; error: string | null } {
  if (!raw.trim()) return { quantity: null, error: null };
  if (!/^\d+$/.test(raw.trim())) return { quantity: null, error: '0 이상의 정수로 입력해 주세요.' };
  const quantity = Number(raw);
  if (!Number.isSafeInteger(quantity) || quantity > QUANTITY_LIMIT) return { quantity: null, error: `${QUANTITY_LIMIT.toLocaleString('ko-KR')}개 이하로 입력해 주세요.` };
  return { quantity, error: null };
}

export function confirmedItems(items: QuantityRow[]): { name: string; quantity: number; unit?: string }[] {
  return items.filter((row): row is QuantityRow & { quantity: number } => row.quantity !== null)
    .map(row => ({ name: row.name.trim(), quantity: row.quantity, ...(row.unit !== undefined ? { unit: row.unit.trim() } : {}) }));
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateRecordDraft(mode: RecordMode, draft: RecordDraft): string | null {
  if (!uuid.test(draft.id)) return '기록을 새로 열어 주세요.';
  if (mode === 'supplies') {
    if (draft.attempted && draft.legacySupplyItems) {
      const items = draft.legacySupplyItems;
      if (!items.length || items.length > 30 || items.some(row => !row.name.trim() || row.name.length > 60 || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > QUANTITY_LIMIT || row.unit !== undefined && (!row.unit.trim() || row.unit.length > 20))) return '이전 비품 기록의 저장 결과를 확인할 수 없습니다. 비품 내역을 확인해 주세요.';
      return null;
    }
    const text = normalizedRequestText(draft.requestText);
    if (!text) return '필요한 비품과 요청 내용을 입력해 주세요.';
    if (text.length > 2000) return '비품 요청 내용은 2,000자 이하로 입력해 주세요.';
    return null;
  }
  if (draft.items.length > 30) return '품목은 30개 이하로 등록해 주세요.';
  if (draft.items.some(row => row.quantity !== null && (!Number.isInteger(row.quantity) || row.quantity < 0 || row.quantity > QUANTITY_LIMIT))) return '수량은 0 이상 10,000 이하의 정수로 입력해 주세요.';
  const checked = confirmedItems(draft.items);
  if (!checked.length) return mode === 'stock' ? '확인한 품목의 현재 총수량을 하나 이상 입력해 주세요.' : '품목과 수량을 하나 이상 입력해 주세요.';
  if (checked.some(row => !row.name || row.name.length > 60)) return '입력한 수량의 품목 이름을 확인해 주세요.';
  if (new Set(checked.map(row => row.name)).size !== checked.length) return '같은 품목이 중복되었습니다. 하나로 합쳐 주세요.';
  if (mode === 'send') {
    if (!checked.some(row => row.quantity > 0)) return '실제로 보낸 품목의 수량을 입력해 주세요.';
    if (draft.quickSend) {
      if (quickSendNotes(draft).length > 2000) return '메모와 이전 초안의 참고 정보를 합쳐 2,000자 이하로 줄여 주세요.';
    } else {
      if (!draft.vendor.trim() || draft.vendor.length > 100) return '이전 기록의 세탁업체를 확인해 주세요.';
      if (!validDate(draft.pickupDate) || !validDate(draft.deliveryDate) || draft.deliveryDate < draft.pickupDate) return '이전 기록의 날짜를 확인해 주세요.';
    }
  }
  return null;
}

export function buildRecordPayload(propertyId: string, mode: Exclude<RecordMode, 'receive'>, draft: RecordDraft, version?: number) {
  if (!propertyId) throw new Error('숙소를 선택해 주세요.');
  const error = validateRecordDraft(mode, draft);
  if (error) throw new Error(error);
  const checked = confirmedItems(draft.items);
  if (mode === 'stock') {
    const pinnedVersion = draft.baseVersion ?? version;
    if (!Number.isInteger(pinnedVersion) || (pinnedVersion as number) < 0) throw new Error('최근 재고 정보를 다시 불러와 주세요.');
    return { id: draft.id, propertyId, version: pinnedVersion, items: checked.map(row => ({ name: row.name, quantity: row.quantity })) };
  }
  if (mode === 'send') {
    const items = checked.filter(row => row.quantity > 0).map(row => ({ name: row.name, sent: row.quantity, received: 0, damaged: 0, rewash: 0 }));
    if (draft.quickSend) {
      const notes = quickSendNotes(draft);
      return { id: draft.id, propertyId, quickSend: true, items, ...(notes ? { notes } : {}) };
    }
    return { id: draft.id, propertyId, pickupDate: draft.pickupDate, deliveryDate: draft.deliveryDate, vendor: draft.vendor.trim(), vendorPhone: draft.vendorPhone.trim(), notes: draft.notes,
      collected: true, items };
  }
  if (draft.attempted && draft.legacySupplyItems) return { id: draft.id, propertyId, items: draft.legacySupplyItems.map(row => ({ ...row })), urgency: draft.urgency };
  return { id: draft.id, propertyId, text: normalizedRequestText(draft.requestText), urgency: draft.urgency };
}

export function hasDraftContent(draft: RecordDraft): boolean {
  const supplyDraft = draft.items.some(row => row.unit !== undefined);
  const defaults = supplyDraft ? SUPPLY_ITEMS : LINEN_ITEMS;
  return draft.items.some((row, index) => row.quantity !== null || !!row.unit?.trim() || index >= defaults.length && !!row.name.trim())
    || !!(draft.requestText.trim() || draft.vendor || draft.pickupDate || draft.deliveryDate || draft.vendorPhone || draft.notes) || draft.urgency !== 'normal' || !!draft.attempted;
}
