import { z } from 'zod';
import type { BackendRoute } from './backend-routes';

const id = z.string().trim().min(1).max(100);
const version = z.number().int().min(0).max(2_147_483_646);
const quantity = z.number().int().min(0).max(10_000);
const name = z.string().trim().min(1).max(100).refine(value => !/[\u0000-\u001f\u007f]/.test(value), '품목 이름을 확인해 주세요.');
export const countedItems = z.array(z.object({ name, quantity }).strict()).min(1).max(30)
  .refine(items => new Set(items.map(item => item.name.normalize('NFC'))).size === items.length, '품목 이름이 중복됩니다.');
export const fieldLaundryItems = z.array(z.object({ name, sent: quantity, received: quantity.default(0), damaged: quantity.default(0), rewash: quantity.default(0) }).strict()
  .refine(item => item.received <= item.sent && item.damaged + item.rewash <= item.received, '입고·파손·재세탁 수량을 확인해 주세요.')).min(1).max(30)
  .refine(items => new Set(items.map(item => item.name)).size === items.length && items.some(item => item.sent > 0), '품목과 보낸 수량을 확인해 주세요.');

export const inventoryCountSchema = z.object({ propertyId: id, version, items: countedItems }).strict();
export const laundryCreateSchema = z.object({ propertyId: id, items: countedItems, notes: z.string().trim().max(2000).default('') }).strict()
  .refine(input => input.items.some(item => item.quantity > 0), '보낸 수량을 입력해 주세요.');
export const laundryUpdateSchema = z.object({ version: version.min(1), action: z.enum(['receive', 'correct']),
  full: z.boolean().optional(), note: z.string().trim().max(2000).default(''), items: fieldLaundryItems.optional(),
  incoming: z.array(z.object({ name, quantity, damaged: quantity.default(0), rewash: quantity.default(0) }).strict()).min(1).max(30).optional(),
}).strict().superRefine((input, context) => {
  if (input.action === 'receive' && ((!input.full && !input.incoming) || (input.full && input.incoming) || input.items)) context.addIssue({ code: 'custom', message: '전체 또는 품목별 입고 수량을 선택해 주세요.' });
  if (input.action === 'correct' && (!input.items || !input.note || input.full || input.incoming)) context.addIssue({ code: 'custom', message: '정정할 수량과 사유를 입력해 주세요.' });
});
export const supplyCreateSchema = z.object({ propertyId: id, text: z.string().trim().min(1).max(2000), urgency: z.enum(['low', 'normal', 'urgent']).default('normal') }).strict();
export const supplyUpdateSchema = z.object({ version, status: z.enum(['approved', 'rejected', 'completed']), note: z.string().trim().max(1000).default('') }).strict()
  .refine(input => input.status !== 'rejected' || input.note.length > 0, '거절 사유를 입력해 주세요.');
export const fieldBodySchemas = { saveInventoryCount: inventoryCountSchema, createLaundry: laundryCreateSchema, updateLaundry: laundryUpdateSchema, createSupply: supplyCreateSchema, updateSupply: supplyUpdateSchema } as const;
export const FIELD_COMMAND_OPERATIONS = { saveInventoryCount: 'inventory.count', createLaundry: 'laundry.create', updateLaundry: 'laundry.update', createSupply: 'supply.create', updateSupply: 'supply.update' } as const;
export const FIELD_ROUTES: readonly BackendRoute[] = [
  { id: 'readInventory', method: 'GET', path: 'inventory', module: 'inventory', summary: '현재 깨끗한 재고와 수량 기록' },
  { id: 'saveInventoryCount', method: 'POST', path: 'inventory/counts', module: 'inventory', mutation: true, summary: '확인한 재고 수량 저장' },
  { id: 'listLaundry', method: 'GET', path: 'laundry', module: 'laundry', summary: '세탁 출고·입고 기록' },
  { id: 'createLaundry', method: 'POST', path: 'laundry', module: 'laundry', mutation: true, status: 201, summary: '세탁 간편 출고' },
  { id: 'updateLaundry', method: 'PATCH', path: 'laundry/:id', module: 'laundry', mutation: true, summary: '세탁 입고·수량 정정' },
  { id: 'listSupplies', method: 'GET', path: 'supplies', module: 'supplies', summary: '비품 요청과 처리 이력' },
  { id: 'createSupply', method: 'POST', path: 'supplies', module: 'supplies', mutation: true, status: 201, summary: '텍스트 비품 요청' },
  { id: 'updateSupply', method: 'PATCH', path: 'supplies/:id', module: 'supplies', mutation: true, summary: '비품 승인·거절·지급 완료' },
  { id: 'settlement', method: 'GET', path: 'settlement', module: 'settlement', summary: '26일~25일 청소 수행 집계' },
  { id: 'exportSettlement', method: 'GET', path: 'settlement/export', module: 'settlement', summary: '권한 내 청소 정산 CSV' },
];
