import { fail } from '../../../lib/core/errors';
import type { LaundryItem } from './types';

export function settlementPeriod(month: string) {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) throw fail(400, '정산 월을 확인해 주세요.');
  const start = new Date(`${month}-01T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 1);
  return { month, from: `${start.toISOString().slice(0, 7)}-26`, to: `${month}-25` };
}
export function currentSettlementMonth(now: Date): string {
  const date = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  if (Number(date.slice(-2)) < 26) return date.slice(0, 7);
  const next = new Date(`${date.slice(0, 7)}-01T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString().slice(0, 7);
}
export function applyReceipt(items: LaundryItem[], incoming: Array<{ name: string; quantity: number; damaged: number; rewash: number }>): LaundryItem[] {
  if (!incoming.some(item => item.quantity > 0) || new Set(incoming.map(item => item.name)).size !== incoming.length) throw fail(400, '중복 없이 입고 수량을 입력해 주세요.');
  const result = items.map(item => ({ ...item }));
  for (const entry of incoming) {
    const item = result.find(item => item.name === entry.name);
    if (!item || ![entry.quantity, entry.damaged, entry.rewash].every(value => Number.isInteger(value) && value >= 0 && value <= 10_000) || entry.damaged + entry.rewash > entry.quantity) throw fail(400, '입고·파손·재세탁 수량을 확인해 주세요.');
    item.received += entry.quantity; item.damaged += entry.damaged; item.rewash += entry.rewash;
    if (item.received > item.sent) throw fail(400, '보낸 수량보다 많이 입고할 수 없습니다. 수량 정정을 이용해 주세요.');
  }
  return result;
}
export function laundryState(items: LaundryItem[]) { return items.every(item => item.sent === item.received) ? 'completed' : items.some(item => item.received > 0) ? 'partial' : 'collected'; }
export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return `"${(/^[\s]*[=+@-]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
}
