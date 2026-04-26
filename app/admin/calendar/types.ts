export const PROPERTY_COLORS = [
  '#6b7d8f', // 슬레이트 블루
  '#b9986e', // 웜 골드
  '#859485', // 세이지 그린
  '#a47670', // 무티드 테라코타
  '#7c6f64', // 토프
  '#8e7689', // 플럼 모브
  '#a08665', // 더스티 카멜
];

export const DISABLED_PROPERTY_NAMES = ['도원재'];

export const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export const DEFAULT_ROOM_READY_MESSAGE =
  '객실 정비가 완료되었습니다. 체크인 준비가 되었으니 편안한 시간 보내시길 바랍니다.';

export interface Property {
  id: string;
  name: string;
  color: string;
  doorPassword?: string;
  addressUrl?: string;
  roomReadyMessage?: string;
}

export interface RawEvent {
  id: string;
  propertyId: string;
  channelId: string;
  source?: string;
  title: string;
  start: string;
  end: string;
  type: 'reservation' | 'block';
  description?: string;
  tags?: string[];
  originalUid?: string | null;
}

export interface Cleaning {
  id: string;
  propertyId: string;
  date: string;
  cleanerId: string | null;
  status: 'pending' | 'done';
  supplies?: string;
}

export interface Cleaner {
  id: string;
  name: string;
  phone: string;
}

export interface SelectedEvent {
  eventId: string;
  title: string;
  start: string;
  end: string;
  propertyId: string;
  propertyName: string;
  propertyColor: string;
  channelId: string;
  channelLabel: string;
  description?: string;
  cleaningId: string | null;
  cleanerId: string | null;
  cleanerName: string | null;
  supplies: string | null;
  status: 'pending' | 'done' | null;
  type: 'reservation' | 'block';
  tags: string[];
  originalUid: string | null;
  source?: string;
}

export interface ProcessedEvent {
  id: string;
  propertyId: string;
  color: string;
  propName: string;
  start: string;
  end: string;
  title: string;
  channelId: string;
  source?: string;
  description?: string;
  cleaningId: string | null;
  cleanerId: string | null;
  cleanerName: string | null;
  supplies: string | null;
  status: 'pending' | 'done' | null;
  type: 'reservation' | 'block';
  tags: string[];
  originalUid: string | null;
}

export interface SupplyTodo {
  id: string;
  text: string;
  done: boolean;
}

export interface GlobalSupplyTodo extends SupplyTodo {
  propertyId: string;
  propertyName: string;
  date: string;
  createdAt: string;
}

export interface ModalMessage {
  id: string;
  text: string;
  sender: string;
  createdAt: string;
  source?: string;
  beds24MessageType?: string;
  deliveryStatus?: string;
  read?: boolean;
}

// ── Utility functions ──

export function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getChannelLabel(
  channelId: string,
  source: string | undefined,
  channelMap: Record<string, string>,
) {
  if (channelId === 'direct') return '직접예약';
  if (channelId === 'beds24') {
    const s = (source || '').toLowerCase();
    if (s.includes('airbnb')) return 'Airbnb';
    if (s.includes('booking')) return 'Booking.com';
    if (s.includes('agoda')) return 'Agoda';
    if (s.includes('stayfolio')) return 'Stayfolio';
    if (s.includes('expedia')) return 'Expedia';
    return '직접예약';
  }
  return channelMap[channelId] || channelId;
}

export function getRoomReadyMessage(properties: Property[], propertyId: string) {
  const prop = properties.find(p => p.id === propertyId);
  if (!prop) return DEFAULT_ROOM_READY_MESSAGE;
  const template = prop.roomReadyMessage || DEFAULT_ROOM_READY_MESSAGE;
  let msg = template
    .replace(/\{password\}/g, prop.doorPassword || '')
    .replace(/\{address\}/g, prop.addressUrl || '');
  if (!prop.roomReadyMessage && (prop.doorPassword || prop.addressUrl)) {
    if (prop.doorPassword) msg += `\n\n비밀번호: ${prop.doorPassword}`;
    if (prop.addressUrl) msg += `\n주소: ${prop.addressUrl}`;
  }
  return msg;
}
